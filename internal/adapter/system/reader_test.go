package system

import (
	"context"
	"testing"
	"testing/fstest"
)

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
