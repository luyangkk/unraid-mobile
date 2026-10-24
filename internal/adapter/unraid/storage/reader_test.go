package storage

import (
	"context"
	"strings"
	"testing"
	"testing/fstest"
)

const disksFixture = `["parity"]
name="parity"
device="sda"
type="Parity"
status="DISK_OK"
size="20000"
spundown="0"
temp="35"
["disk1"]
name="disk1"
device="sdb"
type="Data"
status="DISK_OK"
size="10000"
spundown="0"
temp="31"
fsType="xfs"
fsStatus="Mounted"
fsSize="10000"
fsFree="4000"
fsUsed="6000"
["disk2"]
name="disk2"
device="sdc"
type="Data"
status="DISK_OK"
size="10000"
spundown="1"
temp="*"
fsType="xfs"
fsStatus="Mounted"
fsSize="10000"
fsFree="8000"
fsUsed="2000"
["disk3"]
name="disk3"
device=""
type="Data"
status="DISK_NP"
["cache"]
name="cache"
device="nvme0n1"
type="Cache"
status="DISK_OK"
spundown="0"
fsType="btrfs"
fsStatus="Mounted"
fsSize="3000"
fsFree="1000"
fsUsed="1000"
["cache2"]
name="cache2"
device="nvme1n1"
type="Cache"
status="DISK_OK"
["flash"]
name="flash"
type="Flash"
device="sdd"
fsStatus="Mounted"
fsSize="99999"
fsFree="99999"
`

func filesFixture() fstest.MapFS {
	return fstest.MapFS{
		"var/local/emhttp/disks.ini": {Data: []byte(disksFixture)},
		"var/local/emhttp/var.ini":   {Data: []byte("fsState=\"Started\"\nmdResync=\"0\"\nmdResyncPos=\"0\"\nmdResyncSize=\"1000\"\nmdResyncAction=\"check P\"\ncsrf_token=\"do-not-return\"\n")},
		"proc/diskstats":             {Data: []byte("8 16 sdb 1 0 100 0 1 0 200 0 0 0 0\n")},
	}
}

func TestReaderRead(t *testing.T) {
	t.Run("invalid explicit used capacity remains unknown", func(t *testing.T) {
		f := filesFixture()
		f["var/local/emhttp/disks.ini"] = &fstest.MapFile{Data: []byte(strings.Replace(disksFixture, "fsUsed=\"6000\"", "fsUsed=\"invalid\"", 1))}
		got, err := NewReader(f).Read(context.Background())
		if err != nil || got.Array.Capacity != nil {
			t.Fatalf("array = %+v, %v", got.Array, err)
		}
	})
	t.Run("counts data capacity once and separates parity and mirrored pool", func(t *testing.T) {
		got, err := NewReader(filesFixture()).Read(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		if got.Array.State != "started" || got.Array.DiskCount != 2 || got.Array.Capacity == nil || got.Array.Capacity.TotalBytes != 20000*1024 || got.Array.Capacity.UsedBytes != 8000*1024 {
			t.Fatalf("array = %+v", got.Array)
		}
		if len(got.Disks) != 5 || len(got.Pools) != 1 || got.Pools[0].DiskCount != 2 || got.Pools[0].Capacity == nil || got.Pools[0].Capacity.TotalBytes != 2000*1024 {
			t.Fatalf("pools/disks = %+v %+v", got.Pools, got.Disks)
		}
		if got.Parity.State != "idle" {
			t.Fatalf("parity = %+v", got.Parity)
		}
		found := false
		for _, d := range got.Disks {
			if d.Name == "disk1" {
				found = true
				if d.PowerState != "active" || d.Counters == nil || d.Counters.ReadBytes != 100*512 || d.Temperature == nil || *d.Temperature != 31 {
					t.Fatalf("disk1 = %+v", d)
				}
			}
			if d.Name == "disk2" && (d.PowerState != "standby" || d.Temperature != nil) {
				t.Fatalf("sleeping disk = %+v", d)
			}
		}
		if !found {
			t.Fatal("missing disk1")
		}
	})
	t.Run("unknown spindown metadata stays unknown", func(t *testing.T) {
		f := filesFixture()
		f["var/local/emhttp/disks.ini"] = &fstest.MapFile{Data: []byte(strings.Replace(disksFixture, "spundown=\"0\"\ntemp=\"31\"", "spundown=\"unexpected\"\ntemp=\"31\"", 1))}
		got, err := NewReader(f).Read(context.Background())
		if err != nil {
			t.Fatal(err)
		}
		for _, disk := range got.Disks {
			if disk.Name == "disk1" && disk.PowerState != "unknown" {
				t.Fatalf("power state = %q", disk.PowerState)
			}
		}
	})
	t.Run("missing mount has an actionable error", func(t *testing.T) {
		_, err := NewReader(fstest.MapFS{}).Read(context.Background())
		if err == nil || !strings.Contains(err.Error(), "/host/var/local/emhttp") {
			t.Fatalf("error = %v", err)
		}
	})
	t.Run("stopped array does not reuse stale capacities", func(t *testing.T) {
		f := filesFixture()
		f["var/local/emhttp/var.ini"] = &fstest.MapFile{Data: []byte("fsState=Stopped\n")}
		got, err := NewReader(f).Read(context.Background())
		if err != nil || got.Array.State != "stopped" || got.Array.Capacity != nil {
			t.Fatalf("array = %+v, %v", got.Array, err)
		}
	})
	t.Run("bad disk capacity makes the array total unknown", func(t *testing.T) {
		f := filesFixture()
		f["var/local/emhttp/disks.ini"] = &fstest.MapFile{Data: []byte(strings.Replace(disksFixture, "fsFree=\"4000\"", "fsFree=\"40000\"", 1))}
		got, err := NewReader(f).Read(context.Background())
		if err != nil || got.Array.Capacity != nil || len(got.Diagnostics) == 0 {
			t.Fatalf("result = %+v, %v", got, err)
		}
	})
	t.Run("malformed metadata is rejected instead of showing an empty array", func(t *testing.T) {
		f := filesFixture()
		f["var/local/emhttp/disks.ini"] = &fstest.MapFile{Data: []byte("[\"disk1\"\nfsSize=broken")}
		if _, err := NewReader(f).Read(context.Background()); err == nil {
			t.Fatal("expected parse error")
		}
	})
	t.Run("running and paused parity report observed progress only", func(t *testing.T) {
		for _, tc := range []struct{ active, state string }{{"1", "running"}, {"0", "paused"}} {
			f := filesFixture()
			f["var/local/emhttp/var.ini"] = &fstest.MapFile{Data: []byte("fsState=Started\nmdResync=" + tc.active + "\nmdResyncPos=250\nmdResyncSize=1000\nmdResyncAction=check P\n")}
			got, err := NewReader(f).Read(context.Background())
			if err != nil || got.Parity.State != tc.state || got.Parity.Progress == nil || *got.Parity.Progress != 25 {
				t.Fatalf("parity = %+v, %v", got.Parity, err)
			}
		}
	})
	t.Run("unknown state stays unknown and missing disks stay visible", func(t *testing.T) {
		f := filesFixture()
		delete(f, "var/local/emhttp/var.ini")
		f["var/local/emhttp/disks.ini"] = &fstest.MapFile{Data: []byte(disksFixture + "[\"disk4\"]\nname=disk4\ntype=Data\nstatus=DISK_NP_MISSING\n")}
		got, err := NewReader(f).Read(context.Background())
		if err != nil || got.Array.State != "unknown" || got.Array.DiskCount != 3 || got.Array.Capacity != nil {
			t.Fatalf("array = %+v, %v", got.Array, err)
		}
	})
}
