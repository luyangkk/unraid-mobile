package spike

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"strings"
	"sync"
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

type Config struct {
	HostFS         fs.FS
	RuntimeFS      fs.FS
	DockerEnabled  bool
	VMEnabled      bool
	Timeout        time.Duration
	ModuleTimeout  time.Duration
	SampleInterval time.Duration
	SystemReader   system.Reader
	StorageReader  storage.Provider
	DockerReader   docker.Reader
	VMReader       vm.Reader
}

// ConfigFromEnvironment enables optional reads only for the literal string true.
func ConfigFromEnvironment(getenv func(string) string) Config {
	return Config{DockerEnabled: getenv("SPIKE_DOCKER_READ_ENABLED") == "true",
		VMEnabled: getenv("SPIKE_VM_READ_ENABLED") == "true"}
}

// defaults fixes production filesystems, sockets, and bounded sampling budgets.
func (c Config) defaults() Config {
	if c.HostFS == nil {
		c.HostFS = os.DirFS("/host")
	}
	if c.RuntimeFS == nil {
		c.RuntimeFS = os.DirFS("/")
	}
	if c.Timeout <= 0 {
		c.Timeout = 15 * time.Second
	}
	if c.ModuleTimeout <= 0 {
		c.ModuleTimeout = 6 * time.Second
	}
	if c.SampleInterval <= 0 {
		c.SampleInterval = time.Second
	}
	if c.SystemReader == nil {
		c.SystemReader = systemadapter.NewReader(c.HostFS)
	}
	if c.StorageReader == nil {
		c.StorageReader = storageadapter.NewReader(c.HostFS)
	}
	if c.DockerEnabled && c.DockerReader == nil {
		c.DockerReader = dockeradapter.NewReader(DockerSocket)
	}
	if c.VMEnabled && c.VMReader == nil {
		c.VMReader = libvirtadapter.NewReader()
	}
	return c
}

type outcome[T any] struct {
	value T
	fault string
}

// bounded returns on cancellation even if filesystem I/O ignores context.
// The buffered channel lets an abandoned read finish without blocking its sender.
func bounded[T any](ctx context.Context, read func() T) (T, string) {
	var zero T
	if ctx.Err() != nil {
		return zero, contextFault(ctx)
	}
	ch := make(chan outcome[T], 1)
	go func() {
		result := outcome[T]{}
		defer func() {
			if recover() != nil {
				result.fault = "internalError"
			}
			ch <- result
		}()
		result.value = read()
	}()
	select {
	case result := <-ch:
		if ctx.Err() != nil {
			return zero, contextFault(ctx)
		}
		return result.value, result.fault
	case <-ctx.Done():
		return zero, contextFault(ctx)
	}
}

// contextFault maps cancellation to a fixed code without exposing raw errors.
func contextFault(ctx context.Context) string {
	if ctx.Err() == context.DeadlineExceeded {
		return "timeout"
	}
	return "cancelled"
}

// sampleTwo reuses one production service so adjacent-counter baselines are retained.
func sampleTwo[T any](ctx context.Context, interval time.Duration, collect func(context.Context) T, state func(T) Module) (T, string) {
	first, fault := bounded(ctx, func() T { return collect(ctx) })
	if fault != "" {
		return first, fault
	}
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return first, contextFault(ctx)
	case <-timer.C:
	}
	second, fault := bounded(ctx, func() T { return collect(ctx) })
	if fault != "" {
		return first, fault
	}
	if state(first).Available && !state(second).Available {
		for _, code := range state(second).Diagnostics {
			if code != "collectionUnavailable" {
				return first, code
			}
		}
		return first, "collectionUnavailable"
	}
	if !state(first).ProtocolPassed {
		return second, "earlierSampleIncomplete"
	}
	return second, ""
}

// applyFault preserves completed samples while marking unfinished reads as partial.
func applyFault(m *Module, fault string) {
	if fault == "" {
		return
	}
	m.Diagnostics = append(m.Diagnostics, fault)
	m.ProtocolPassed = false
	m.internal = fault == "internalError"
	m.Status = "failed"
	if m.Available {
		m.Status = "partial"
	}
}

// skipped describes an optional module without touching its protocol.
func skipped() Module {
	return Module{Status: "skipped", Diagnostics: []string{}}
}

// Run probes every module independently within both module and whole-run deadlines.
func Run(parent context.Context, config Config) Report {
	c := config.defaults()
	ctx, cancel := context.WithTimeout(parent, c.Timeout)
	defer cancel()
	r := Report{Version: "1", ReadOnly: true,
		UnverifiedCapabilities: []string{"allWrites", "arrayStart", "arrayStop", "parityStart",
			"parityPause", "parityResume", "parityCancel", "dockerStart", "dockerStop", "dockerRestart",
			"vmStart", "vmStop", "vmForceStop", "socketAPIAuthorization", "vmUptime", "privilegedDisabled"},
		Docker: DockerReport{Module: skipped()}, VM: VMReport{Module: skipped()}}
	var wg sync.WaitGroup
	wg.Add(3)
	go func() {
		defer wg.Done()
		probeCtx, stop := context.WithTimeout(ctx, c.ModuleTimeout)
		defer stop()
		r.Checks, r.Mounts, r.internal = inspectSurfaces(probeCtx, c)
	}()
	go func() {
		defer wg.Done()
		moduleCtx, stop := context.WithTimeout(ctx, c.ModuleTimeout)
		defer stop()
		service := system.NewService(c.SystemReader, time.Now)
		snapshot, fault := sampleTwo(moduleCtx, c.SampleInterval, service.Collect,
			func(s system.Snapshot) Module { return projectSystem(s).Module })
		r.System = projectSystem(snapshot)
		applyFault(&r.System.Module, fault)
	}()
	go func() {
		defer wg.Done()
		moduleCtx, stop := context.WithTimeout(ctx, c.ModuleTimeout)
		defer stop()
		service := storage.NewService(c.StorageReader, time.Now)
		snapshot, fault := sampleTwo(moduleCtx, c.SampleInterval, service.Collect,
			func(s storage.Snapshot) Module { return projectStorage(s).Module })
		r.Storage = projectStorage(snapshot)
		applyFault(&r.Storage.Module, fault)
	}()
	if c.DockerEnabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			moduleCtx, stop := context.WithTimeout(ctx, c.ModuleTimeout)
			defer stop()
			if !socketAvailable(moduleCtx, c.RuntimeFS, DockerSocket) {
				r.Docker.Module = module(false, []string{"socketUnavailable"}, false)
				return
			}
			service := docker.NewService(c.DockerReader, time.Now)
			snapshot, fault := sampleTwo(moduleCtx, c.SampleInterval, service.Collect,
				func(s docker.Snapshot) Module { return projectDocker(s).Module })
			r.Docker = projectDocker(snapshot)
			applyFault(&r.Docker.Module, fault)
		}()
	}
	if c.VMEnabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			moduleCtx, stop := context.WithTimeout(ctx, c.ModuleTimeout)
			defer stop()
			if !socketAvailable(moduleCtx, c.RuntimeFS, LibvirtSocket) {
				r.VM.Module = module(false, []string{"socketUnavailable"}, false)
				return
			}
			service := vm.NewService(c.VMReader, time.Now)
			snapshot, fault := sampleTwo(moduleCtx, c.SampleInterval, service.Collect,
				func(s vm.Snapshot) Module { return projectVM(s).Module })
			r.VM = projectVM(snapshot)
			applyFault(&r.VM.Module, fault)
		}()
	}
	wg.Wait()
	r.GeneratedAt = time.Now().UTC()
	for _, check := range r.Checks {
		if check.Error == "internalError" {
			r.internal = true
		}
	}
	for _, mount := range r.Mounts {
		if mount.Enabled && !mount.ReadOnlyVerified {
			r.UnverifiedCapabilities = append(r.UnverifiedCapabilities, "mountReadOnly:"+mount.Target)
		}
	}
	for _, capability := range []struct {
		name   string
		passed bool
	}{
		{"systemRead", r.System.ProtocolPassed},
		{"storageRead", r.Storage.ProtocolPassed},
		{"dockerRead", r.Docker.ProtocolPassed},
		{"vmRead", r.VM.ProtocolPassed},
		{"systemCPUUsage", r.System.CPUUsage != nil},
		{"systemTemperature", r.System.CPUTemperature != nil},
		{"systemUptime", r.System.UptimeSeconds != nil},
		{"systemNetwork", r.System.NetworkRXRate != nil && r.System.NetworkTXRate != nil && r.System.NetworkInterface != "unknown"},
		{"arrayRead", r.Storage.Available && r.Storage.Array.State != "unknown"},
		{"parityRead", r.Storage.Available && r.Storage.Parity.State != "unknown"},
	} {
		if !capability.passed {
			r.UnverifiedCapabilities = append(r.UnverifiedCapabilities, capability.name)
		}
	}
	for _, diagnostic := range r.Storage.Diagnostics {
		if diagnostic == "parityProgressUnavailable" {
			r.UnverifiedCapabilities = append(r.UnverifiedCapabilities, "parityProgress")
		}
	}
	for _, diagnostic := range r.Docker.Diagnostics {
		if diagnostic == "networkCountersUnavailable" {
			r.UnverifiedCapabilities = append(r.UnverifiedCapabilities, "dockerNetwork")
		}
	}
	return r
}

type fileResult struct {
	info fs.FileInfo
	err  error
}

// statSurface checks only the explicit mounted path and never falls back to host-local data.
func statSurface(ctx context.Context, files fs.FS, name string) (fileResult, string) {
	return bounded(ctx, func() fileResult {
		info, err := fs.Stat(files, name)
		return fileResult{info: info, err: err}
	})
}

// socketAvailable rejects regular files and writable-socket lookalikes.
func socketAvailable(ctx context.Context, files fs.FS, path string) bool {
	result, fault := statSurface(ctx, files, strings.TrimPrefix(path, "/"))
	return fault == "" && result.err == nil && result.info.Mode()&fs.ModeSocket != 0
}

// inspectSurfaces separates required files from optional sensors and enabled sockets.
func inspectSurfaces(ctx context.Context, c Config) ([]Check, []Mount, bool) {
	checks := make([]Check, 0, len(RequiredSurfaces)+4)
	for _, path := range RequiredSurfaces {
		checks = append(checks, inspectFile(ctx, c.HostFS, strings.TrimPrefix(path, "/host/"),
			Check{Path: path, Required: true, Enabled: true}, false))
	}
	for _, path := range []string{HostProcUptime, HostProcRoute, HostProcNetDev, HostSysThermal, HostSysHwmon} {
		checks = append(checks, inspectFile(ctx, c.HostFS, strings.TrimPrefix(path, "/host/"),
			Check{Path: path, Enabled: true}, false))
	}
	for _, optional := range []struct {
		path    string
		enabled bool
	}{{DockerSocket, c.DockerEnabled}, {LibvirtSocket, c.VMEnabled}} {
		check := Check{Path: optional.path, Enabled: optional.enabled}
		if optional.enabled {
			check = inspectFile(ctx, c.RuntimeFS, strings.TrimPrefix(optional.path, "/"), check, true)
		}
		checks = append(checks, check)
	}
	mounts := []Mount{
		{Source: "/proc", Target: "/host/proc", Enabled: true},
		{Source: "/sys", Target: "/host/sys", Enabled: true},
		{Source: "/var/local/emhttp", Target: UnraidStatePath, Enabled: true},
		{Source: DockerSocket, Target: DockerSocket, Enabled: c.DockerEnabled},
		{Source: "/var/run/libvirt", Target: "/var/run/libvirt", Enabled: c.VMEnabled},
	}
	data, evidenceFault := bounded(ctx, func() []byte {
		content, _ := fs.ReadFile(c.RuntimeFS, "proc/self/mountinfo")
		return content
	})
	internal := evidenceFault == "internalError"
	for i := range mounts {
		m := &mounts[i]
		m.IntendedMode, m.ObservedMode, m.Evidence, m.Permissions = "readOnly", "unknown", "none", "unknown"
		if !m.Enabled {
			continue
		}
		files, name := c.RuntimeFS, strings.TrimPrefix(m.Target, "/")
		if strings.HasPrefix(m.Target, "/host/") {
			files, name = c.HostFS, strings.TrimPrefix(m.Target, "/host/")
		}
		result, fault := statSurface(ctx, files, name)
		internal = internal || fault == "internalError"
		if fault == "" && result.err == nil {
			m.Permissions = fmt.Sprintf("%04o", result.info.Mode().Perm())
		}
		observeMount(m, string(data))
	}
	return checks, mounts, internal
}

// inspectFile exposes fixed availability codes rather than filesystem errors.
func inspectFile(ctx context.Context, files fs.FS, name string, check Check, socket bool) Check {
	result, fault := statSurface(ctx, files, name)
	check.Available = fault == "" && result.err == nil
	if check.Available && socket {
		check.Available = result.info.Mode()&fs.ModeSocket != 0
	}
	if !check.Available {
		check.Error = "surfaceUnavailable"
		if errors.Is(result.err, fs.ErrNotExist) {
			check.Error = "surfaceMissing"
		} else if errors.Is(result.err, fs.ErrPermission) {
			check.Error = "permissionDenied"
		}
		if fault != "" {
			check.Error = fault
		}
	}
	return check
}

// observeMount exports only an exact target's VFS flags, never raw mount metadata.
func observeMount(m *Mount, data string) {
	for _, line := range strings.Split(data, "\n") {
		fields := strings.Fields(line)
		if len(fields) < 10 || fields[4] != m.Target {
			continue
		}
		separator := -1
		for i := 6; i < len(fields); i++ {
			if fields[i] == "-" {
				separator = i
				break
			}
		}
		if separator < 6 || len(fields) < separator+4 {
			continue
		}
		for _, option := range strings.Split(fields[5], ",") {
			switch option {
			case "ro":
				m.ObservedMode, m.Evidence, m.ReadOnlyVerified = "readOnly", "mountinfo", true
			case "rw":
				m.ObservedMode, m.Evidence, m.ReadOnlyVerified = "readWrite", "mountinfo", false
			}
		}
	}
}
