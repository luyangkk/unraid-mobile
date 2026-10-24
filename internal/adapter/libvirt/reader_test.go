package libvirt

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"

	client "github.com/digitalocean/go-libvirt"
)

type fakeClient struct {
	listErr, stateErr, xmlErr error
	count                     uint32
	flags                     client.ConnectListAllDomainsFlags
}

func (f *fakeClient) ConnectListAllDomains(need int32, flags client.ConnectListAllDomainsFlags) ([]client.Domain, uint32, error) {
	f.flags = flags
	if need != 1 {
		panic("list must return active and inactive domains")
	}
	return []client.Domain{{Name: "Windows", UUID: client.UUID{1, 2, 3}}}, f.count, f.listErr
}
func (f *fakeClient) DomainGetState(client.Domain, uint32) (int32, int32, error) {
	return 1, 0, f.stateErr
}
func (f *fakeClient) DomainGetXMLDesc(_ client.Domain, flags client.DomainXMLFlags) (string, error) {
	if flags != 0 {
		panic("must not request secure XML")
	}
	return `<domain><memory unit="KiB">33554432</memory><currentMemory unit="KiB">16777216</currentMemory><vcpu current="8">16</vcpu><devices><disk><source file="private-disk-path"/></disk></devices><metadata>private-metadata</metadata></domain>`, f.xmlErr
}

func TestReaderWhitelistAndPartialFailure(t *testing.T) {
	for _, partial := range []string{"", "state", "xml"} {
		t.Run(partial, func(t *testing.T) {
			f := &fakeClient{count: 1}
			if partial == "state" {
				f.stateErr = errors.New("private-state-error")
			}
			if partial == "xml" {
				f.xmlErr = errors.New("private-xml-error")
			}
			closed := false
			r := &Reader{connect: func(context.Context) (readClient, func(), error) { return f, func() { closed = true }, nil }}
			got, err := r.Read(context.Background())
			if err != nil || !closed || len(got.Domains) != 1 {
				t.Fatalf("read: %+v %v closed=%v", got, err, closed)
			}
			d := got.Domains[0]
			if d.ID != "01020300-0000-0000-0000-000000000000" || (partial != "state" && d.State != "running") || d.UptimeSeconds != nil {
				t.Fatalf("domain: %+v", d)
			}
			if partial == "state" && d.State != "unknown" {
				t.Fatal("state failure fabricated a state")
			}
			if partial != "xml" && (*d.VCPUs != 8 || *d.MemoryBytes != 16<<30) {
				t.Fatalf("assigned resources: %+v", d)
			}
			if partial == "xml" && (d.VCPUs != nil || d.MemoryBytes != nil) {
				t.Fatal("XML failure fabricated metrics")
			}
			if f.flags != client.ConnectListDomainsActive|client.ConnectListDomainsInactive {
				t.Fatal("not listing all domains")
			}
			data, _ := json.Marshal(got)
			for _, secret := range []string{"private-", "<domain", "<source", "<metadata"} {
				if strings.Contains(string(data), secret) {
					t.Fatalf("leaked %s: %s", secret, data)
				}
			}
		})
	}
}

func TestReaderFailuresAreSanitized(t *testing.T) {
	r := &Reader{connect: func(context.Context) (readClient, func(), error) {
		return nil, nil, errors.New("secret socket failure")
	}}
	if _, err := r.Read(context.Background()); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("connect error: %v", err)
	}
	f := &fakeClient{listErr: errors.New("secret daemon error")}
	r.connect = func(context.Context) (readClient, func(), error) { return f, func() {}, nil }
	if _, err := r.Read(context.Background()); err == nil || strings.Contains(err.Error(), "secret") {
		t.Fatalf("list error: %v", err)
	}
	f.listErr = nil
	f.count = maxDomains + 1
	if _, err := r.Read(context.Background()); err == nil {
		t.Fatal("accepted oversized list")
	}
}

func TestAssignedResources(t *testing.T) {
	for _, tc := range []struct {
		xml    string
		cpu    uint32
		memory uint64
	}{
		{`<domain><memory>1048576</memory><vcpu>2</vcpu></domain>`, 2, 1 << 30},
		{`<domain><memory unit="GiB">4</memory><vcpu current="1">4</vcpu></domain>`, 1, 4 << 30},
		{`<domain><memory unit="MB">2</memory><vcpu>1</vcpu></domain>`, 1, 2000000},
		{`<domain><memory unit="bytes">4096</memory><vcpu>1</vcpu></domain>`, 1, 4096},
	} {
		d := assignedResources(tc.xml)
		if d.VCPUs == nil || *d.VCPUs != tc.cpu || d.MemoryBytes == nil || *d.MemoryBytes != tc.memory {
			t.Fatalf("%s: %+v", tc.xml, d)
		}
	}
	for _, xml := range []string{
		`<domain><memory unit="invalid">4</memory><vcpu>0</vcpu></domain>`,
		`<domain><memory unit="GiB">18446744073709551615</memory><vcpu current="8">4</vcpu></domain>`,
		`<domain><memory>bad</memory><vcpu>bad</vcpu></domain>`,
		`<secret><memory>4</memory><vcpu>1</vcpu></secret>`,
		`<domain>`,
	} {
		d := assignedResources(xml)
		if d.VCPUs != nil || d.MemoryBytes != nil || len(d.Diagnostics) == 0 {
			t.Fatalf("invalid config: %s %+v", xml, d)
		}
	}
}

func TestStateMapping(t *testing.T) {
	for code, want := range map[int32]string{0: "unknown", 1: "running", 2: "blocked", 3: "paused", 4: "shutdown", 5: "shutoff", 6: "crashed", 7: "pmsuspended", 99: "unknown"} {
		if got := stateName(code); got != want {
			t.Fatalf("state %d: %s", code, got)
		}
	}
}

func TestCanceledRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := NewReader()
	start := time.Now()
	if _, err := r.Read(ctx); err == nil || time.Since(start) > time.Second {
		t.Fatal("canceled read did not terminate")
	}
}

// TestReadOnlyProtocol exercises the actual client against synthetic RPC responses.
func TestReadOnlyProtocol(t *testing.T) {
	local, remote := net.Pipe()
	defer remote.Close()
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	serverDone := make(chan error, 1)
	go func() {
		for _, procedure := range []uint32{66, 1, 273, 212, 14} {
			var size uint32
			if err := binary.Read(remote, binary.BigEndian, &size); err != nil {
				serverDone <- err
				return
			}
			if size < 28 || size > 4096 {
				serverDone <- fmt.Errorf("invalid request size: %d", size)
				return
			}
			request := make([]byte, size-4)
			if _, err := io.ReadFull(remote, request); err != nil {
				serverDone <- err
				return
			}
			header := request[:24]
			if got := binary.BigEndian.Uint32(header[8:12]); got != procedure {
				serverDone <- fmt.Errorf("unexpected RPC: %d want %d", got, procedure)
				return
			}
			var payload bytes.Buffer
			put := func(v uint32) { _ = binary.Write(&payload, binary.BigEndian, v) }
			str := func(v string) {
				put(uint32(len(v)))
				payload.WriteString(v)
				for payload.Len()%4 != 0 {
					payload.WriteByte(0)
				}
			}
			switch procedure {
			case 66:
				put(1)
				put(0) // AuthList: no authentication.
			case 1:
				if !bytes.Contains(request[24:], []byte("qemu:///system")) {
					serverDone <- errors.New("unexpected connection URI")
					return
				}
			case 273:
				if !bytes.Equal(request[24:], []byte{0, 0, 0, 1, 0, 0, 0, 3}) {
					serverDone <- errors.New("must list active and inactive domains")
					return
				}
				put(1)
				str("Synthetic VM")
				payload.Write(make([]byte, 16))
				put(7)
				put(1)
			case 212:
				put(1)
				put(0)
			case 14:
				str(`<domain><memory unit="MiB">1024</memory><vcpu>2</vcpu></domain>`)
			}
			binary.BigEndian.PutUint32(header[12:16], 1) // Reply.
			binary.BigEndian.PutUint32(header[20:24], 0) // Success.
			var response bytes.Buffer
			binary.Write(&response, binary.BigEndian, uint32(28+payload.Len()))
			response.Write(header)
			response.Write(payload.Bytes())
			if _, err := remote.Write(response.Bytes()); err != nil {
				serverDone <- err
				return
			}
		}
		serverDone <- nil
	}()
	r := &Reader{connect: func(ctx context.Context) (readClient, func(), error) { return openReadOnly(ctx, local) }}
	got, err := r.Read(ctx)
	if err != nil || len(got.Domains) != 1 || got.Domains[0].State != "running" || *got.Domains[0].MemoryBytes != 1<<30 {
		t.Fatalf("wire snapshot: %+v %v", got, err)
	}
	if err := <-serverDone; err != nil {
		t.Fatal(err)
	}
}

func TestUnresponsiveHandshakeIsCancelled(t *testing.T) {
	local, remote := net.Pipe()
	defer remote.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, closeConn, err := openReadOnly(ctx, local)
		if closeConn != nil {
			closeConn()
		}
		done <- err
	}()
	// Wait for the authentication request so cancellation occurs during the handshake.
	request := make([]byte, 28)
	if _, err := io.ReadFull(remote, request); err != nil {
		t.Fatal(err)
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("stalled handshake succeeded")
		}
	case <-time.After(time.Second):
		t.Fatal("cancellation leaked a stalled connection")
	}
}
