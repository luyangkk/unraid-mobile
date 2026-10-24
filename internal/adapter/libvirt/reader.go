// Package libvirt reads a fixed set of domain fields through the local read-only socket.
package libvirt

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"math"
	"net"
	"sort"
	"strings"
	"time"

	client "github.com/digitalocean/go-libvirt"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
)

const (
	socketPath    = "/var/run/libvirt/libvirt-sock-ro"
	maxDomains    = 1024
	maxXMLBytes   = 2 << 20
	sampleTimeout = 6 * time.Second
)

// This interface intentionally contains no domain mutation or arbitrary QEMU calls.
type readClient interface {
	ConnectListAllDomains(int32, client.ConnectListAllDomainsFlags) ([]client.Domain, uint32, error)
	DomainGetState(client.Domain, uint32) (int32, int32, error)
	DomainGetXMLDesc(client.Domain, client.DomainXMLFlags) (string, error)
}

type Reader struct {
	connect func(context.Context) (readClient, func(), error)
}

func NewReader() *Reader { return &Reader{connect: connectReadOnly} }

func connectReadOnly(ctx context.Context) (readClient, func(), error) {
	conn, err := (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, "unix", socketPath)
	if err != nil {
		return nil, nil, err
	}
	return openReadOnly(ctx, conn)
}

// openReadOnly uses the server's read-only socket; it never falls back to libvirt-sock.
// Closing the connection on cancellation bounds even an unresponsive handshake.
func openReadOnly(ctx context.Context, conn net.Conn) (readClient, func(), error) {
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	closeConn := func() { stop(); _ = conn.Close() }
	lib := client.New(conn)
	if err := lib.ConnectToURI(client.QEMUSystem); err != nil {
		closeConn()
		return nil, nil, err
	}
	return lib, closeConn, nil
}

func (r *Reader) Read(ctx context.Context) (vm.Snapshot, error) {
	ctx, cancel := context.WithTimeout(ctx, sampleTimeout)
	defer cancel()
	if ctx.Err() != nil {
		return vm.Snapshot{}, errors.New("VM collection cancelled")
	}
	lib, closeConn, err := r.connect(ctx)
	if err != nil {
		return vm.Snapshot{}, errors.New("VM provider unavailable; mount /var/run/libvirt read-only and check libvirt-sock-ro permissions")
	}
	defer closeConn()
	domains, count, err := lib.ConnectListAllDomains(1, client.ConnectListDomainsActive|client.ConnectListDomainsInactive)
	if err != nil {
		return vm.Snapshot{}, errors.New("VM list unavailable from libvirt")
	}
	if count > maxDomains || len(domains) > maxDomains || int(count) != len(domains) {
		return vm.Snapshot{}, errors.New("VM list exceeds limits or is incomplete")
	}
	result := vm.Snapshot{Domains: make([]vm.Domain, 0, len(domains)), Diagnostics: []string{}}
	for _, domain := range domains {
		d := vm.Domain{ID: fmt.Sprintf("%x-%x-%x-%x-%x", domain.UUID[:4], domain.UUID[4:6], domain.UUID[6:8], domain.UUID[8:10], domain.UUID[10:]), Name: domain.Name, State: "unknown", Diagnostics: []string{}}
		if ctx.Err() != nil {
			d.Diagnostics = append(d.Diagnostics, "VM details unavailable; sample deadline reached")
		} else {
			state, _, stateErr := lib.DomainGetState(domain, 0)
			if stateErr != nil {
				d.Diagnostics = append(d.Diagnostics, "VM state unavailable")
			} else {
				d.State = stateName(state)
			}
			config, xmlErr := lib.DomainGetXMLDesc(domain, 0)
			if xmlErr != nil {
				d.Diagnostics = append(d.Diagnostics, "Assigned VM resources unavailable")
			} else {
				resources := assignedResources(config)
				d.VCPUs, d.MemoryBytes = resources.VCPUs, resources.MemoryBytes
				d.Diagnostics = append(d.Diagnostics, resources.Diagnostics...)
			}
		}
		// libvirt CPU time is accumulated vCPU time, not elapsed uptime.
		if d.State != "shutoff" {
			d.Diagnostics = append(d.Diagnostics, "Uptime unavailable; libvirt does not report a reliable boot timestamp")
		}
		result.Domains = append(result.Domains, d)
	}
	// A disconnected or timed-out round is unavailable, rather than a list of stale states.
	if ctx.Err() != nil {
		return vm.Snapshot{}, errors.New("VM collection timed out or cancelled")
	}
	sort.Slice(result.Domains, func(i, j int) bool {
		if result.Domains[i].Name == result.Domains[j].Name {
			return result.Domains[i].ID < result.Domains[j].ID
		}
		return result.Domains[i].Name < result.Domains[j].Name
	})
	return result, nil
}

func stateName(state int32) string {
	switch client.DomainState(state) {
	case client.DomainRunning:
		return "running"
	case client.DomainBlocked:
		return "blocked"
	case client.DomainPaused:
		return "paused"
	case client.DomainShutdown:
		return "shutdown"
	case client.DomainShutoff:
		return "shutoff"
	case client.DomainCrashed:
		return "crashed"
	case client.DomainPmsuspended:
		return "pmsuspended"
	default:
		return "unknown"
	}
}

type memoryConfig struct {
	Unit  string `xml:"unit,attr"`
	Value uint64 `xml:",chardata"`
}

// assignedResources parses only display fields. It never exports or accepts VM XML via HTTP.
func assignedResources(config string) vm.Domain {
	d := vm.Domain{Diagnostics: []string{}}
	var fields struct {
		XMLName       xml.Name      `xml:"domain"`
		Memory        memoryConfig  `xml:"memory"`
		CurrentMemory *memoryConfig `xml:"currentMemory"`
		CPU           struct {
			Current *uint32 `xml:"current,attr"`
			Maximum uint32  `xml:",chardata"`
		} `xml:"vcpu"`
	}
	if len(config) > maxXMLBytes || xml.Unmarshal([]byte(config), &fields) != nil {
		d.Diagnostics = append(d.Diagnostics, "Assigned VM resources unavailable; invalid domain configuration")
		return d
	}
	cpu := fields.CPU.Maximum
	if fields.CPU.Current != nil {
		cpu = *fields.CPU.Current
	}
	if cpu > 0 && cpu <= fields.CPU.Maximum {
		d.VCPUs = &cpu
	} else {
		d.Diagnostics = append(d.Diagnostics, "Assigned vCPU count unavailable")
	}
	memory := fields.Memory
	if fields.CurrentMemory != nil {
		memory = *fields.CurrentMemory
	}
	multiplier := uint64(0)
	switch strings.ToLower(memory.Unit) {
	case "b", "byte", "bytes":
		multiplier = 1
	case "", "k", "kib":
		multiplier = 1 << 10
	case "m", "mib":
		multiplier = 1 << 20
	case "g", "gib":
		multiplier = 1 << 30
	case "t", "tib":
		multiplier = 1 << 40
	case "kb":
		multiplier = 1000
	case "mb":
		multiplier = 1000000
	case "gb":
		multiplier = 1000000000
	case "tb":
		multiplier = 1000000000000
	}
	if multiplier > 0 && memory.Value > 0 && memory.Value <= math.MaxUint64/multiplier {
		bytes := memory.Value * multiplier
		d.MemoryBytes = &bytes
	} else {
		d.Diagnostics = append(d.Diagnostics, "Assigned memory unavailable")
	}
	return d
}
