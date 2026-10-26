package system

import (
	"context"
	"encoding/json"
	"io/fs"
	"os"
	"reflect"
	"testing"
	"testing/fstest"
	"time"

	domain "github.com/unraid-mobile/unraid-mobile/internal/app/system"
)

type countingFS struct {
	fs.FS
	opens map[string]int
}

// Open counts mounted file reads while delegating to the synthetic filesystem.
func (f *countingFS) Open(name string) (fs.File, error) {
	f.opens[name]++
	return f.FS.Open(name)
}

// TestReaderNetworkSingleRead checks counters are sampled once regardless of interface count.
func TestReaderNetworkSingleRead(t *testing.T) {
	files := &countingFS{FS: fixture(), opens: map[string]int{}}
	if _, err := NewReader(files).Read(context.Background()); err != nil {
		t.Fatal(err)
	}
	if files.opens["proc/1/net/dev"] != 1 || files.opens["proc/1/net/route"] != 1 || files.opens["proc/net/dev"] != 0 {
		t.Fatalf("mounted network read counts = %v", files.opens)
	}
}

// TestReaderSyntheticNetworkFixtures checks real mounted fixture parsing and service projection.
func TestReaderSyntheticNetworkFixtures(t *testing.T) {
	reader := NewReader(os.DirFS("../../../testdata/host"))
	raw, err := reader.Read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	items := rawInterfaces(t, raw)
	names := []string{}
	for _, item := range items {
		names = append(names, item.Name)
		if !item.Available || item.Identity == nil {
			t.Fatalf("synthetic interface must have readable counters and ifindex: %+v", item)
		}
	}
	if !reflect.DeepEqual(names, []string{"br0", "eth0", "lo", "veth1"}) {
		t.Fatalf("synthetic interface names = %v", names)
	}
	now := time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC)
	svc := domain.NewService(reader, func() time.Time { return now })
	first := svc.Collect(context.Background())
	for _, item := range first.NetworkInterfaces {
		if item.RXBytesPerSecond != nil || item.TXBytesPerSecond != nil {
			t.Fatalf("first synthetic rates must be null: %+v", item)
		}
	}
	now = now.Add(2 * time.Second)
	got := svc.Collect(context.Background())
	for _, item := range got.NetworkInterfaces {
		if item.RXBytesPerSecond == nil || *item.RXBytesPerSecond != 0 || item.TXBytesPerSecond == nil || *item.TXBytesPerSecond != 0 {
			t.Fatalf("unchanged synthetic rates must be zero: %+v", item)
		}
	}
	if got.NetworkInterface != "br0" || got.NetworkRXRate == nil || *got.NetworkRXRate != 0 || got.NetworkTXRate == nil || *got.NetworkTXRate != 0 {
		t.Fatalf("synthetic Auto projection = %+v", got)
	}
}

// rawInterfaces decodes reader output without requiring the new domain type.
func rawInterfaces(t *testing.T, raw any) []struct {
	Name      string
	Available bool
	Reason    string
	RX, TX    uint64
	Identity  *uint64
} {
	t.Helper()
	data, err := json.Marshal(raw)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		NetworkInterfaces []struct {
			Name      string
			Available bool
			Reason    string
			RX, TX    uint64
			Identity  *uint64
		}
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	return decoded.NetworkInterfaces
}

// TestReaderNetworkInterfaces checks mounted counters independently from Auto routes.
func TestReaderNetworkInterfaces(t *testing.T) {
	t.Run("sorted interfaces and lowest valid default metric", func(t *testing.T) {
		files := fixture()
		files["proc/1/net/dev"].Data = []byte("veth1: 9000 0 0 0 0 0 0 0 8000 0 0 0 0 0 0 0\nlo: 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0\nbr0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n")
		files["proc/1/net/route"].Data = []byte("Iface Destination Gateway Flags RefCnt Use Metric Mask\nlo 00000000 0 0000 0 0 1 00000000\nlo 00000000 0 broken 0 0 0 00000000\nlo 00000000 0 0001 0 0 bad 00000000\nlo 00000000 0 0001 0 0 0 FFFFFFFF\nveth1 00000000 0 0001 0 0 100 00000000\nbr0 00000000 0 0003 0 0 10 00000000\n")
		files["sys/class/net/br0/ifindex"] = &fstest.MapFile{Data: []byte("12\n")}
		files["sys/class/net/veth1/ifindex"] = &fstest.MapFile{Data: []byte("invalid\n")}
		raw, err := NewReader(files).Read(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		items := rawInterfaces(t, raw)
		names := []string{}
		for _, item := range items {
			names = append(names, item.Name)
			if !item.Available {
				t.Fatalf("readable interface unavailable: %+v", item)
			}
		}
		if !reflect.DeepEqual(names, []string{"br0", "lo", "veth1"}) {
			t.Fatalf("interface names = %v, want [br0 lo veth1]", names)
		}
		if items[0].RX != 1000 || items[0].TX != 2000 || items[0].Identity == nil || *items[0].Identity != 12 || items[2].Identity != nil {
			t.Fatalf("counters or identity = %+v", items)
		}
		if raw.NetworkInterface != "br0" || !raw.NetworkAvailable || raw.NetworkRX != items[0].RX || raw.NetworkTX != items[0].TX {
			t.Fatalf("Auto projection = %+v", raw)
		}
	})
	for _, scenario := range []string{"missing route", "malformed route", "no default", "missing dev", "malformed row"} {
		t.Run(scenario, func(t *testing.T) {
			files := fixture()
			switch scenario {
			case "missing route":
				delete(files, "proc/1/net/route")
			case "malformed route":
				files["proc/1/net/route"].Data = []byte("br0 nonsense\n")
			case "no default":
				files["proc/1/net/route"].Data = []byte("br0 0000000A 0 0001 0 0 0 00FFFFFF\n")
			case "missing dev":
				delete(files, "proc/1/net/dev")
				files["proc/net/dev"] = &fstest.MapFile{Data: []byte("eth0: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0")}
			case "malformed row":
				files["proc/1/net/dev"].Data = []byte("br0: invalid 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\nveth1: 9000 0 0 0 0 0 0 0 8000 0 0 0 0 0 0 0\nshort: 1 2\n")
			}
			raw, err := NewReader(files).Read(context.Background())
			if err != nil || raw.MemoryTotal == 0 || raw.CPUTotal == 0 {
				t.Fatalf("network failure discarded System: %+v, %v", raw, err)
			}
			items := rawInterfaces(t, raw)
			if scenario == "missing dev" {
				if items == nil || len(items) != 0 || raw.NetworkAvailable || raw.Diagnostics["network"] == "" {
					t.Fatalf("missing mounted counters = %+v, items=%v", raw, items)
				}
			} else if scenario == "malformed row" {
				if len(items) != 3 || items[0].Available || items[0].Reason == "" || items[1].Available || !items[2].Available || raw.NetworkAvailable {
					t.Fatalf("malformed rows must be isolated: %+v", items)
				}
			} else if len(items) != 2 || !items[0].Available || !items[1].Available || raw.NetworkAvailable || raw.Diagnostics["network"] == "" {
				t.Fatalf("route failure discarded manual counters: %+v", raw)
			}
		})
	}
}

func fixture() fstest.MapFS {
	return fstest.MapFS{
		"proc/stat":                          {Data: []byte("cpu  10 0 10 70 10 0 0 0 100 50\ncpu0 1 2\n")},
		"proc/meminfo":                       {Data: []byte("MemTotal: 8192 kB\nMemAvailable: 2048 kB\n")},
		"etc/hostname":                       {Data: []byte("Tower\n")},
		"proc/uptime":                        {Data: []byte("123.50 0\n")},
		"proc/1/net/route":                   {Data: []byte("Iface Destination Gateway Flags RefCnt Use Metric Mask\nbr0 00000000 0100000A 0003 0 0 100 00000000\n")},
		"proc/1/net/dev":                     {Data: []byte("Inter-| Receive | Transmit\n face |bytes\n br0: 1000 0 0 0 0 0 0 0 2000 0 0 0 0 0 0 0\n veth1: 9999 0 0 0 0 0 0 0 9999 0 0 0 0 0 0 0\n")},
		"sys/class/hwmon/hwmon0/name":        {Data: []byte("nvme\n")},
		"sys/class/hwmon/hwmon0/temp1_input": {Data: []byte("90000\n")},
		"sys/class/hwmon/hwmon1/name":        {Data: []byte("coretemp\n")},
		"sys/class/hwmon/hwmon1/temp1_label": {Data: []byte("Package id 0\n")},
		"sys/class/hwmon/hwmon1/temp1_input": {Data: []byte("42000\n")},
	}
}

func TestReaderRead(t *testing.T) {
	t.Run("never uses container hostname when host name is unknown", func(t *testing.T) {
		files := fixture()
		delete(files, "etc/hostname")
		files["proc/sys/kernel/hostname"] = &fstest.MapFile{Data: []byte("container-id")}
		reader := NewReader(files)
		got, err := reader.Read(context.Background())
		if err != nil || got.Hostname != "" {
			t.Fatalf("hostname=%q, err=%v", got.Hostname, err)
		}
		reader.Hostname = "Configured Tower"
		got, err = reader.Read(context.Background())
		if err != nil || got.Hostname != "Configured Tower" {
			t.Fatalf("override=%q, err=%v", got.Hostname, err)
		}
	})
	t.Run("reads host counters and labelled CPU temperature", func(t *testing.T) {
		got, err := NewReader(fixture()).Read(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if got.CPUTotal != 100 || got.CPUIdle != 80 || got.MemoryTotal != 8192*1024 || got.MemoryAvailable != 2048*1024 {
			t.Fatalf("counters = %+v", got)
		}
		if got.NetworkInterface != "br0" || got.NetworkRX != 1000 || got.NetworkTX != 2000 {
			t.Fatalf("network = %+v", got)
		}
		if got.CPUTemperature == nil || *got.CPUTemperature != 42 || got.Hostname != "Tower" || got.UptimeSeconds == nil || *got.UptimeSeconds != 123.5 {
			t.Fatalf("host = %+v", got)
		}
	})
	t.Run("does not fall back to container network or board sensor", func(t *testing.T) {
		files := fixture()
		delete(files, "proc/1/net/dev")
		files["proc/net/dev"] = &fstest.MapFile{Data: []byte("eth0: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0")}
		delete(files, "sys/class/hwmon/hwmon1/temp1_input")
		got, err := NewReader(files).Read(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if got.NetworkAvailable || got.NetworkRX != 0 || got.CPUTemperature != nil || got.Diagnostics["network"] == "" || got.Diagnostics["temperature"] == "" {
			t.Fatalf("partial = %+v", got)
		}
	})
	for _, tc := range []struct{ name, path, value string }{
		{"invalid cpu", "proc/stat", "cpu 10 broken 20 30\n"},
		{"missing memory field", "proc/meminfo", "MemTotal: 100 kB\n"},
		{"invalid available memory", "proc/meminfo", "MemTotal: 10 kB\nMemAvailable: 20 kB\n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			files := fixture()
			files[tc.path] = &fstest.MapFile{Data: []byte(tc.value)}
			if _, err := NewReader(files).Read(context.Background()); err == nil {
				t.Fatal("expected error")
			}
		})
	}
	t.Run("thermal fallback checks sensor type", func(t *testing.T) {
		files := fixture()
		delete(files, "sys/class/hwmon/hwmon1/temp1_input")
		files["sys/class/thermal/thermal_zone0/type"] = &fstest.MapFile{Data: []byte("acpitz")}
		files["sys/class/thermal/thermal_zone0/temp"] = &fstest.MapFile{Data: []byte("80000")}
		files["sys/class/thermal/thermal_zone1/type"] = &fstest.MapFile{Data: []byte("x86_pkg_temp")}
		files["sys/class/thermal/thermal_zone1/temp"] = &fstest.MapFile{Data: []byte("43000")}
		got, err := NewReader(files).Read(context.Background())
		if err != nil || got.CPUTemperature == nil || *got.CPUTemperature != 43 {
			t.Fatalf("fallback = %+v, %v", got, err)
		}
	})
}
