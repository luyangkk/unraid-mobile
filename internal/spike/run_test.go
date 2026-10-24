package spike

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	dockeradapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/docker"
	libvirtadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/libvirt"
	systemadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/system"
	storageadapter "github.com/unraid-mobile/unraid-mobile/internal/adapter/unraid/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
)

var (
	_ system.Reader    = (*systemadapter.Reader)(nil)
	_ storage.Provider = (*storageadapter.Reader)(nil)
	_ docker.Reader    = (*dockeradapter.Reader)(nil)
	_ vm.Reader        = (*libvirtadapter.Reader)(nil)
)

// fixtureConfig uses only the repository's synthetic host files.
func fixtureConfig(t *testing.T) Config {
	t.Helper()
	files := fstest.MapFS{}
	root := os.DirFS("../../testdata/host")
	err := fs.WalkDir(root, ".", func(name string, entry fs.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		data, err := fs.ReadFile(root, name)
		files[name] = &fstest.MapFile{Data: data, Mode: 0444}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return Config{HostFS: files, RuntimeFS: fstest.MapFS{}, Timeout: time.Second,
		ModuleTimeout: 200 * time.Millisecond, SampleInterval: time.Millisecond}
}

// TestRunDisabledOptionals verifies strict opt-in and a successful required run.
func TestRunDisabledOptionals(t *testing.T) {
	c := fixtureConfig(t)
	r := Run(context.Background(), c)
	if r.ExitCode() != 0 || !r.System.Available || !r.Storage.Available {
		t.Fatalf("required modules: %+v", r)
	}
	if r.Docker.Status != "skipped" || r.VM.Status != "skipped" || r.Docker.Enabled || r.VM.Enabled {
		t.Fatalf("optionals: %+v %+v", r.Docker, r.VM)
	}
	if !r.ReadOnly || r.WriteVerified || r.Version != "1" || r.GeneratedAt.Location() != time.UTC {
		t.Fatalf("report envelope: %+v", r)
	}
	hasDiskRate := false
	for _, disk := range r.Storage.Disks {
		hasDiskRate = hasDiskRate || disk.ReadBytesPerSecond != nil
	}
	if r.System.NetworkRXRate == nil || !hasDiskRate {
		t.Fatalf("second-cycle rates missing: %+v %+v", r.System, r.Storage.Disks)
	}
	for _, m := range r.Mounts {
		if m.ObservedMode != "unknown" || m.ReadOnlyVerified {
			t.Fatalf("stat success claimed mount verification: %+v", m)
		}
	}
}

// TestRunMissingRequiredPreservesOtherModules verifies isolation from preflight failures.
func TestRunMissingRequiredPreservesOtherModules(t *testing.T) {
	for _, name := range []string{"proc/stat", "proc/meminfo",
		"proc/diskstats", "var/local/emhttp/disks.ini", "var/local/emhttp/var.ini"} {
		t.Run(name, func(t *testing.T) {
			c := fixtureConfig(t)
			delete(c.HostFS.(fstest.MapFS), name)
			r := Run(context.Background(), c)
			if r.ExitCode() != 2 {
				t.Fatalf("missing %s accepted: %+v", name, r)
			}
			found := false
			for _, check := range r.Checks {
				if check.Path == "/host/"+name {
					found = true
					if check.Available || check.Error == "" {
						t.Fatalf("missing check: %+v", check)
					}
				}
			}
			if !found {
				t.Fatalf("missing required check %s", name)
			}
			if strings.HasPrefix(name, "var/") && !r.System.Available {
				t.Fatal("storage failure discarded system")
			}
		})
	}
}

// TestRunEnabledMissingSockets verifies enabled optionals fail without fallback.
func TestRunEnabledMissingSockets(t *testing.T) {
	c := fixtureConfig(t)
	c.DockerEnabled, c.VMEnabled = true, true
	// A writable socket lookalike must not satisfy the read-only libvirt check.
	c.RuntimeFS = fstest.MapFS{"var/run/libvirt/libvirt-sock": {Mode: fs.ModeSocket | 0600}}
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || r.Docker.Available || r.VM.Available ||
		r.Docker.Status != "failed" || r.VM.Status != "failed" || !r.System.Available || !r.Storage.Available {
		t.Fatalf("socket failures: %+v", r)
	}
}

type dockerFunc func(context.Context) (docker.Raw, error)

// Read implements the production Docker reader contract.
func (f dockerFunc) Read(ctx context.Context) (docker.Raw, error) { return f(ctx) }

type vmFunc func(context.Context) (vm.Snapshot, error)

// Read implements the production VM reader contract.
func (f vmFunc) Read(ctx context.Context) (vm.Snapshot, error) { return f(ctx) }

type systemFunc func(context.Context) (system.Raw, error)

// Read implements the production System reader contract.
func (f systemFunc) Read(ctx context.Context) (system.Raw, error) { return f(ctx) }

// enableReaders supplies protocol boundaries while retaining real services.
func enableReaders(c *Config) {
	c.DockerEnabled, c.VMEnabled = true, true
	c.RuntimeFS = fstest.MapFS{
		"var/run/docker.sock":             {Mode: fs.ModeSocket | 0600},
		"var/run/libvirt/libvirt-sock-ro": {Mode: fs.ModeSocket | 0600},
	}
	c.DockerReader = dockerFunc(func(context.Context) (docker.Raw, error) { return docker.Raw{}, nil })
	c.VMReader = vmFunc(func(context.Context) (vm.Snapshot, error) { return vm.Snapshot{}, nil })
}

// TestRunPartialModulesSanitizesAllProviderContent verifies per-resource diagnostics survive as codes.
func TestRunPartialModulesSanitizesAllProviderContent(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	secret := "SECRET_serial_label_XML_env_token"
	c.DockerReader = dockerFunc(func(context.Context) (docker.Raw, error) {
		return docker.Raw{Containers: []docker.RawContainer{
			{ID: secret, Name: secret, State: "running", Diagnostics: []string{secret}},
			{ID: secret, Name: secret, State: "exited"},
		}}, nil
	})
	c.VMReader = vmFunc(func(context.Context) (vm.Snapshot, error) {
		cpu, ram := uint32(4), uint64(1024)
		return vm.Snapshot{Domains: []vm.Domain{
			{ID: secret, Name: secret, State: "running", VCPUs: &cpu, MemoryBytes: &ram,
				Diagnostics: []string{"Uptime unavailable; libvirt does not report a reliable boot timestamp"}},
			{ID: secret, Name: secret, State: "shutoff", Diagnostics: []string{secret}},
		}}, nil
	})
	files := c.HostFS.(fstest.MapFS)
	files["var/local/emhttp/disks.ini"] = &fstest.MapFile{Mode: 0444, Data: []byte(
		"[" + secret + "]\ntype=data\ndevice=sda\nid=" + secret + "\nstatus=" + secret +
			"\nfsStatus=Mounted\nfsType=" + secret + "\nfsSize=invalid\nspundown=1\ntemp=42\n")}
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || r.Storage.Status != "partial" || r.Docker.Status != "partial" || r.VM.Status != "partial" {
		t.Fatalf("partial states: %+v", r)
	}
	if !r.Docker.Available || r.Docker.Count != 2 || r.Docker.Summary.Running != 1 || r.Docker.Summary.Stopped != 1 ||
		r.VM.Count != 2 || r.VM.VCPUAvailableCount != 1 || r.VM.MemoryAvailableCount != 1 {
		t.Fatalf("partial summaries: %+v %+v", r.Docker, r.VM)
	}
	if r.Storage.Disks[0].Temperature != nil {
		t.Fatal("standby disk temperature must be null")
	}
	data, err := json.Marshal(r)
	if err != nil || bytes.Contains(data, []byte(secret)) {
		t.Fatalf("secret escaped projection: %s %v", data, err)
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		t.Fatal(err)
	}
	want := []string{"version", "generatedAt", "readOnly", "writeVerified", "checks",
		"mounts", "unverifiedCapabilities", "system", "storage", "docker", "vm"}
	if len(fields) != len(want) {
		t.Fatalf("unexpected JSON envelope: %s", data)
	}
	for _, key := range want {
		if _, ok := fields[key]; !ok {
			t.Fatalf("missing camelCase key %s", key)
		}
	}
	for _, forbidden := range []string{`"hostname"`, `"name"`, `"device"`, `"identity"`, `"id"`,
		`"labels"`, `"environment"`, `"xml"`} {
		if bytes.Contains(data, []byte(forbidden)) {
			t.Fatalf("unapproved field %s in %s", forbidden, data)
		}
	}
}

// TestRunVMKnownUptimeLimitationDoesNotFail verifies expected unavailable uptime is not a protocol failure.
func TestRunVMKnownUptimeLimitationDoesNotFail(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	c.VMReader = vmFunc(func(context.Context) (vm.Snapshot, error) {
		cpu, ram := uint32(2), uint64(4096)
		return vm.Snapshot{Domains: []vm.Domain{{State: "running", VCPUs: &cpu, MemoryBytes: &ram,
			Diagnostics: []string{"Uptime unavailable; libvirt does not report a reliable boot timestamp"}}}}, nil
	})
	r := Run(context.Background(), c)
	if r.ExitCode() != 0 || r.VM.Status != "passed" || len(r.VM.Diagnostics) == 0 {
		t.Fatalf("expected limitation failed run: %+v", r)
	}
}

// TestRunTimeoutPreservesFirstSample verifies a stalled second protocol call cannot erase a good first sample.
func TestRunTimeoutPreservesFirstSample(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	c.ModuleTimeout = 30 * time.Millisecond
	var reads atomic.Int32
	c.DockerReader = dockerFunc(func(ctx context.Context) (docker.Raw, error) {
		if reads.Add(1) == 1 {
			return docker.Raw{Containers: []docker.RawContainer{{State: "exited"}}}, nil
		}
		<-ctx.Done()
		return docker.Raw{}, ctx.Err()
	})
	start := time.Now()
	r := Run(context.Background(), c)
	if time.Since(start) > 500*time.Millisecond || r.ExitCode() != 2 || r.Docker.Count != 1 ||
		!r.Docker.Available || r.Docker.Status != "partial" || !r.System.Available || !r.VM.Available {
		t.Fatalf("timeout discarded results: %+v", r)
	}
}

// TestRunBoundsUncooperativeReader verifies the whole run does not wait on a blocked dependency.
func TestRunBoundsUncooperativeReader(t *testing.T) {
	c := fixtureConfig(t)
	c.Timeout = 20 * time.Millisecond
	c.ModuleTimeout = time.Second
	release := make(chan struct{})
	defer close(release)
	c.SystemReader = systemFunc(func(context.Context) (system.Raw, error) {
		<-release
		return system.Raw{}, errors.New("SECRET")
	})
	start := time.Now()
	r := Run(context.Background(), c)
	if time.Since(start) > 500*time.Millisecond || r.ExitCode() != 2 || !r.Storage.Available {
		t.Fatalf("unbounded or lost storage: %+v", r)
	}
}

// TestRunCancelledAndInternalFailure verifies distinct external and internal exit outcomes.
func TestRunCancelledAndInternalFailure(t *testing.T) {
	c := fixtureConfig(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := Run(ctx, c)
	if r.ExitCode() != 2 {
		t.Fatalf("cancel exit = %d", r.ExitCode())
	}
	c.SystemReader = systemFunc(func(context.Context) (system.Raw, error) { panic("SECRET") })
	r = Run(context.Background(), c)
	if r.ExitCode() != 1 || !r.Storage.Available {
		t.Fatalf("internal failure = %+v", r)
	}
	var buf bytes.Buffer
	if WriteReport(&buf, r) != 1 || strings.Contains(buf.String(), "SECRET") {
		t.Fatalf("internal encoding: %s", buf.String())
	}
	delete(c.HostFS.(fstest.MapFS), "proc/stat")
	r = Run(context.Background(), c)
	if r.ExitCode() != 1 {
		t.Fatalf("missing surface masked internal failure: %+v", r)
	}
	if WriteReport(errorWriter{}, Report{}) != 1 {
		t.Fatal("encoding failure did not return 1")
	}
}

type errorWriter struct{}

// Write models a broken output stream.
func (errorWriter) Write([]byte) (int, error) { return 0, errors.New("SECRET") }

// TestMountEvidenceDistinguishesReadOnlyFromReadWrite verifies exact mount evidence, not stat.
func TestMountEvidenceDistinguishesReadOnlyFromReadWrite(t *testing.T) {
	c := fixtureConfig(t)
	c.RuntimeFS = fstest.MapFS{"proc/self/mountinfo": {Data: []byte(
		"1 0 0:1 / / rw - overlay SECRET rw\n" +
			"2 1 0:2 / /host/proc ro,nosuid - proc SECRET rw\n" +
			"3 1 0:3 / /host/var/local/emhttp rw - tmpfs SECRET rw\n")}}
	r := Run(context.Background(), c)
	for _, m := range r.Mounts {
		switch m.Target {
		case "/host/proc":
			if !m.ReadOnlyVerified || m.ObservedMode != "readOnly" || m.Evidence != "mountinfo" {
				t.Fatalf("ro evidence: %+v", m)
			}
		case "/host/var/local/emhttp":
			if m.ReadOnlyVerified || m.ObservedMode != "readWrite" {
				t.Fatalf("rw evidence: %+v", m)
			}
		case "/host/sys":
			if m.ReadOnlyVerified || m.ObservedMode != "unknown" {
				t.Fatalf("ancestor mount counted as intended mount: %+v", m)
			}
		}
	}
}

// TestRunDoesNotEraseEarlierProtocolFailure verifies both required sampling rounds matter.
func TestRunDoesNotEraseEarlierProtocolFailure(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	var calls atomic.Int32
	c.DockerReader = dockerFunc(func(context.Context) (docker.Raw, error) {
		if calls.Add(1) == 1 {
			return docker.Raw{}, errors.New("SECRET protocol error")
		}
		return docker.Raw{Containers: []docker.RawContainer{{State: "exited"}}}, nil
	})
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || !r.Docker.Available || r.Docker.Count != 1 || r.Docker.Status != "partial" {
		t.Fatalf("earlier failure erased: %+v", r.Docker)
	}
}

// TestRunPreservesCompletedSampleOnSecondProtocolFailure verifies a later failure retains sanitized observations.
func TestRunPreservesCompletedSampleOnSecondProtocolFailure(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	var calls atomic.Int32
	c.DockerReader = dockerFunc(func(context.Context) (docker.Raw, error) {
		if calls.Add(1) == 2 {
			return docker.Raw{}, errors.New("SECRET protocol error")
		}
		return docker.Raw{Containers: []docker.RawContainer{{State: "exited"}}}, nil
	})
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || !r.Docker.Available || r.Docker.Count != 1 || r.Docker.Status != "partial" {
		t.Fatalf("completed sample erased: %+v", r.Docker)
	}
}

type panicFS struct{}

// Open models an internal filesystem dependency failure rather than missing host data.
func (panicFS) Open(string) (fs.File, error) { panic("SECRET internal stat failure") }

// TestRunInternalPreflightFailureReturnsOne distinguishes internal failures from host incompatibility.
func TestRunInternalPreflightFailureReturnsOne(t *testing.T) {
	c := fixtureConfig(t)
	c.RuntimeFS = panicFS{}
	r := Run(context.Background(), c)
	if r.ExitCode() != 1 || !r.System.Available || !r.Storage.Available {
		t.Fatalf("internal preflight result: %+v", r)
	}
}

// TestConfigEnvironmentStrictOptIn verifies production flags and truthy spellings never opt in.
func TestConfigEnvironmentStrictOptIn(t *testing.T) {
	for _, value := range []string{"", "1", "TRUE", "True", " true", "true ", "false", "true"} {
		env := map[string]string{"DOCKER_READ_ENABLED": "true", "VM_READ_ENABLED": "true",
			"DOCKER_HOST": "SECRET", "SPIKE_DOCKER_READ_ENABLED": value, "SPIKE_VM_READ_ENABLED": value}
		c := ConfigFromEnvironment(func(key string) string { return env[key] })
		if c.DockerEnabled != (value == "true") || c.VMEnabled != (value == "true") {
			t.Fatalf("env %q opted in incorrectly: %+v", value, c)
		}
	}
}

// TestDefaultConfigUsesProductionReaders checks wiring without making socket requests.
func TestDefaultConfigUsesProductionReaders(t *testing.T) {
	c := fixtureConfig(t)
	c.DockerEnabled, c.VMEnabled = true, true
	c = c.defaults()
	if _, ok := c.SystemReader.(*systemadapter.Reader); !ok {
		t.Fatal("system reader is not production adapter")
	}
	if _, ok := c.StorageReader.(*storageadapter.Reader); !ok {
		t.Fatal("storage reader is not production adapter")
	}
	if _, ok := c.DockerReader.(*dockeradapter.Reader); !ok {
		t.Fatal("docker reader is not production adapter")
	}
	if _, ok := c.VMReader.(*libvirtadapter.Reader); !ok {
		t.Fatal("VM reader is not production adapter")
	}
}

// TestRunOptionalDockerNetworkCountersDoNotFailProtocol checks supported reads with unsupported optional metrics.
func TestRunOptionalDockerNetworkCountersDoNotFailProtocol(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	c.DockerReader = dockerFunc(func(context.Context) (docker.Raw, error) {
		return docker.Raw{Containers: []docker.RawContainer{{State: "running",
			Diagnostics: []string{"Container network counters unavailable"}}}}, nil
	})
	r := Run(context.Background(), c)
	if r.ExitCode() != 0 || !r.Docker.Available || r.Docker.Status != "partial" {
		t.Fatalf("optional network metric failed protocol: %+v", r)
	}
	if len(r.Docker.Diagnostics) != 1 || r.Docker.Diagnostics[0] != "networkCountersUnavailable" {
		t.Fatalf("optional network metric claimed validated: %+v", r.Docker)
	}
}

// TestRunMissingOptionalHostMetricsPass checks absent optional files do not fail basic protocols.
func TestRunMissingOptionalHostMetricsPass(t *testing.T) {
	c := fixtureConfig(t)
	files := c.HostFS.(fstest.MapFS)
	for _, name := range []string{"proc/uptime", "proc/1/net/route", "proc/1/net/dev"} {
		delete(files, name)
	}
	r := Run(context.Background(), c)
	if r.ExitCode() != 0 || r.System.Status != "partial" || r.System.UptimeSeconds != nil ||
		r.System.NetworkRXRate != nil || len(r.System.Diagnostics) == 0 {
		t.Fatalf("optional files failed basic reads: %+v", r)
	}
}

// TestSystemDiagnosticJSONStable checks map iteration cannot reorder or duplicate report codes.
func TestSystemDiagnosticJSONStable(t *testing.T) {
	s := system.Snapshot{Available: true, Diagnostics: map[string]string{
		"temperature": "SECRET", "network": "SECRET", "secretKey": "SECRET", "otherKey": "SECRET"}}
	first, err := json.Marshal(projectSystem(s))
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100; i++ {
		next, err := json.Marshal(projectSystem(s))
		if err != nil || !bytes.Equal(first, next) {
			t.Fatalf("unstable JSON: %s != %s: %v", first, next, err)
		}
	}
}

// TestRunVMUnknownStateFailsProtocol checks state availability independently of assigned resources.
func TestRunVMUnknownStateFailsProtocol(t *testing.T) {
	c := fixtureConfig(t)
	enableReaders(&c)
	c.VMReader = vmFunc(func(context.Context) (vm.Snapshot, error) {
		cpu, ram := uint32(2), uint64(4096)
		return vm.Snapshot{Domains: []vm.Domain{{State: "unknown", VCPUs: &cpu, MemoryBytes: &ram}}}, nil
	})
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || r.VM.Status != "partial" {
		t.Fatalf("unknown VM state accepted: %+v", r.VM)
	}
}

// TestRunDisabledProtocolsAreUntouched checks skipped reads never access optional sockets or readers.
func TestRunDisabledProtocolsAreUntouched(t *testing.T) {
	c := fixtureConfig(t)
	c.DockerReader = dockerFunc(func(context.Context) (docker.Raw, error) { panic("optional Docker read") })
	c.VMReader = vmFunc(func(context.Context) (vm.Snapshot, error) { panic("optional VM read") })
	c.RuntimeFS = optionalGuardFS{FS: fstest.MapFS{}}
	r := Run(context.Background(), c)
	if r.ExitCode() != 0 || r.Docker.Status != "skipped" || r.VM.Status != "skipped" {
		t.Fatalf("disabled protocol touched: %+v", r)
	}
}

type optionalGuardFS struct{ fs.FS }

// Open rejects optional protocol paths while allowing mount evidence observation.
func (f optionalGuardFS) Open(name string) (fs.File, error) {
	if strings.HasPrefix(name, "var/run/") {
		panic("optional socket stat")
	}
	return f.FS.Open(name)
}

// TestModuleProjectionRejectsMissingStatesAndResources checks absent protocol fields cannot pass silently.
func TestModuleProjectionRejectsMissingStatesAndResources(t *testing.T) {
	for _, s := range []storage.Snapshot{
		{Available: true, Array: storage.Array{State: "unknown"}, Parity: storage.Parity{State: "idle"}},
		{Available: true, Array: storage.Array{State: "started"}, Parity: storage.Parity{State: "unknown"}},
		{Available: true, Array: storage.Array{State: "stopped"}, Parity: storage.Parity{State: "idle"},
			Pools: []storage.Pool{{State: "Mounted"}}},
	} {
		if m := projectStorage(s).Module; m.ProtocolPassed || m.Status != "partial" {
			t.Fatalf("missing storage state passed: %+v", m)
		}
	}
	for _, diagnostic := range []string{"Container inspect unavailable", "Container stats unavailable",
		"Container CPU counters unavailable", "Container memory counters unavailable", "SECRET"} {
		m := projectDocker(docker.Snapshot{Available: true,
			Containers: []docker.Container{{State: "running", Diagnostics: []string{diagnostic}}}}).Module
		if m.ProtocolPassed || m.Status != "partial" {
			t.Fatalf("failed Docker read passed: %+v", m)
		}
	}
	cpu, ram := uint32(2), uint64(4096)
	for _, domain := range []vm.Domain{{State: "running", VCPUs: &cpu}, {State: "shutoff", MemoryBytes: &ram}} {
		if m := projectVM(vm.Snapshot{Available: true, Domains: []vm.Domain{domain}}).Module; m.ProtocolPassed {
			t.Fatalf("missing VM resources passed: %+v", m)
		}
	}
}

// TestSystemInterfaceWhitelist permits comparison without exporting arbitrary host metadata.
func TestSystemInterfaceWhitelist(t *testing.T) {
	for _, name := range []string{"shim-br0", "eth0", "bond0", "br0", "enp3s0", "ens18"} {
		r := projectSystem(system.Snapshot{Available: true, NetworkInterface: name})
		data, _ := json.Marshal(r)
		if !bytes.Contains(data, []byte(`"networkInterface":"`+name+`"`)) {
			t.Fatalf("safe interface omitted: %s", data)
		}
	}
	for _, name := range []string{"SECRET_token_device", "eth0\nSECRET", "<xml>", "vethabcdef"} {
		data, _ := json.Marshal(projectSystem(system.Snapshot{Available: true, NetworkInterface: name}))
		if bytes.Contains(data, []byte(name)) {
			t.Fatalf("sensitive interface leaked: %s", data)
		}
	}
}

// TestInspectFileClassifiesFailures checks actionable fixed codes without raw path or error details.
func TestInspectFileClassifiesFailures(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code string
	}{{fs.ErrNotExist, "surfaceMissing"}, {fs.ErrPermission, "permissionDenied"}, {errors.New("SECRET"), "surfaceUnavailable"}} {
		c := inspectFile(context.Background(), failedFS{err: tc.err}, "SECRET", Check{Enabled: true}, false)
		if c.Available || c.Error != tc.code {
			t.Fatalf("wrong error class: %+v", c)
		}
	}
}

// TestRunInvalidRequiredDataKeepsSanitizedReason checks malformed CPU input cannot pass or leak source bytes.
func TestRunInvalidRequiredDataKeepsSanitizedReason(t *testing.T) {
	c := fixtureConfig(t)
	c.HostFS.(fstest.MapFS)["proc/stat"] = &fstest.MapFile{Data: []byte("cpu SECRET invalid metadata")}
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || r.System.ProtocolPassed || !r.Storage.ProtocolPassed {
		t.Fatalf("invalid required data result: %+v", r)
	}
	found := false
	for _, diagnostic := range r.System.Diagnostics {
		found = found || diagnostic == "invalidData"
	}
	data, _ := json.Marshal(r)
	if !found || bytes.Contains(data, []byte("SECRET")) {
		t.Fatalf("unhelpful or raw error: %s", data)
	}
}

// TestLibvirtFixedReadOnlySocketRejectsWritableFallback checks fake sockets never broaden the production boundary.
func TestLibvirtFixedReadOnlySocketRejectsWritableFallback(t *testing.T) {
	if LibvirtSocket != "/var/run/libvirt/libvirt-sock-ro" {
		t.Fatal("libvirt read-only socket changed")
	}
	c := fixtureConfig(t)
	c.VMEnabled = true
	c.RuntimeFS = fstest.MapFS{
		"var/run/libvirt/libvirt-sock-ro": {Mode: 0600},
		"var/run/libvirt/libvirt-sock":    {Mode: fs.ModeSocket | 0600},
	}
	c.VMReader = vmFunc(func(context.Context) (vm.Snapshot, error) { panic("writable fallback was used") })
	r := Run(context.Background(), c)
	if r.ExitCode() != 2 || r.VM.Available || r.VM.Status != "failed" || !r.Storage.ProtocolPassed {
		t.Fatalf("writable fallback accepted: %+v", r)
	}
}

type failedFS struct{ err error }

// Open wraps filesystem failures to verify errors.Is classification across path wrappers.
func (f failedFS) Open(name string) (fs.File, error) {
	return nil, &fs.PathError{Op: "SECRET", Path: name, Err: f.err}
}

// TestRunBoundsUncooperativeSurfaceChecks checks metadata readers cannot bypass overall cancellation.
func TestRunBoundsUncooperativeSurfaceChecks(t *testing.T) {
	c := fixtureConfig(t)
	c.Timeout = 20 * time.Millisecond
	c.ModuleTimeout = time.Second
	release := make(chan struct{})
	defer close(release)
	c.RuntimeFS = blockingFS{release: release}
	start := time.Now()
	r := Run(context.Background(), c)
	if time.Since(start) > 500*time.Millisecond || !r.System.Available || !r.Storage.Available {
		t.Fatalf("unbounded metadata observation: %+v", r)
	}
}

type blockingFS struct{ release <-chan struct{} }

// Open simulates an uncooperative metadata reader without leaking a permanent goroutine.
func (f blockingFS) Open(string) (fs.File, error) {
	<-f.release
	return nil, errors.New("SECRET metadata error")
}

type storageFunc func(context.Context) (storage.Snapshot, error)

// Read injects a storage snapshot without duplicating production parsing.
func (f storageFunc) Read(ctx context.Context) (storage.Snapshot, error) {
	return f(ctx)
}

// TestRunParityProgressRequiredOnlyDuringResync checks active resync cannot pass without its size metadata.
func TestRunParityProgressRequiredOnlyDuringResync(t *testing.T) {
	for _, state := range []string{"running", "paused", "idle", "not_configured"} {
		t.Run(state, func(t *testing.T) {
			c := fixtureConfig(t)
			c.StorageReader = storageFunc(func(context.Context) (storage.Snapshot, error) {
				return storage.Snapshot{Array: storage.Array{State: "stopped"}, Parity: storage.Parity{State: state}}, nil
			})
			r := Run(context.Background(), c)
			required := state == "running" || state == "paused"
			if r.Storage.ProtocolPassed == required || (r.ExitCode() == 2) != required {
				t.Fatalf("progress contract for %s: %+v", state, r.Storage)
			}
			if required && !strings.Contains(strings.Join(r.Storage.Diagnostics, ","), "parityProgressUnavailable") {
				t.Fatalf("missing progress diagnosis: %+v", r.Storage)
			}
		})
	}
}

// TestRunUnverifiedReadCapabilities checks skipped protocols and optional metric gaps remain explicit.
func TestRunUnverifiedReadCapabilities(t *testing.T) {
	c := fixtureConfig(t)
	delete(c.HostFS.(fstest.MapFS), "proc/1/net/route")
	delete(c.HostFS.(fstest.MapFS), "sys/class/hwmon/hwmon1/name")
	r := Run(context.Background(), c)
	for _, capability := range []string{"dockerRead", "vmRead", "systemNetwork", "systemTemperature"} {
		if !strings.Contains(strings.Join(r.UnverifiedCapabilities, ","), capability) {
			t.Fatalf("%s absent from unverified capabilities: %+v", capability, r)
		}
	}
	if r.ExitCode() != 0 {
		t.Fatalf("optional metrics failed basic protocol: %+v", r)
	}
	delete(c.HostFS.(fstest.MapFS), "proc/stat")
	delete(c.HostFS.(fstest.MapFS), "var/local/emhttp/var.ini")
	r = Run(context.Background(), c)
	for _, capability := range []string{"systemRead", "storageRead"} {
		if !strings.Contains(strings.Join(r.UnverifiedCapabilities, ","), capability) {
			t.Fatalf("%s absent after failure: %+v", capability, r)
		}
	}
}

// TestProtocolFailureReasonsRemainActionable checks compatibility failures retain safe reason classes.
func TestProtocolFailureReasonsRemainActionable(t *testing.T) {
	for _, tc := range []struct {
		reason string
		code   string
	}{
		{"Docker Engine API version unsupported", "apiVersionUnsupported"},
		{"Docker Engine API version unavailable", "apiVersionUnavailable"},
		{"Docker Engine unavailable; check the Unix socket mount and permissions", "socketConnectionUnavailable"},
		{"VM provider unavailable; mount /var/run/libvirt read-only and check libvirt-sock-ro permissions", "socketConnectionUnavailable"},
		{"SECRET unknown provider response", "protocolUnavailable"},
	} {
		r := projectDocker(docker.Snapshot{Reason: tc.reason})
		if !strings.Contains(strings.Join(r.Diagnostics, ","), tc.code) || r.ProtocolPassed {
			t.Fatalf("reason class lost: %q: %+v", tc.reason, r)
		}
		data, _ := json.Marshal(r)
		if bytes.Contains(data, []byte("SECRET")) {
			t.Fatalf("raw failure leaked: %s", data)
		}
	}
}
