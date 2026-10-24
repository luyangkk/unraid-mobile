package spike

import (
	"encoding/json"
	"io"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/unraid-mobile/unraid-mobile/internal/app/docker"
	"github.com/unraid-mobile/unraid-mobile/internal/app/storage"
	"github.com/unraid-mobile/unraid-mobile/internal/app/system"
	"github.com/unraid-mobile/unraid-mobile/internal/app/vm"
)

type Module struct {
	Enabled        bool     `json:"enabled"`
	Available      bool     `json:"available"`
	Status         string   `json:"status"`
	ProtocolPassed bool     `json:"protocolPassed"`
	Diagnostics    []string `json:"diagnostics"`
	internal       bool
}

type SystemReport struct {
	Module
	UptimeSeconds    *float64 `json:"uptimeSeconds"`
	CPUUsage         *float64 `json:"cpuUsage"`
	CPUTemperature   *float64 `json:"cpuTemperature"`
	MemoryUsedBytes  uint64   `json:"memoryUsedBytes"`
	MemoryTotalBytes uint64   `json:"memoryTotalBytes"`
	NetworkRXRate    *float64 `json:"networkRXRate"`
	NetworkTXRate    *float64 `json:"networkTXRate"`
	NetworkInterface string   `json:"networkInterface"`
}

type PoolReport struct {
	State     string            `json:"state"`
	DiskCount int               `json:"diskCount"`
	Capacity  *storage.Capacity `json:"capacity"`
}

type DiskReport struct {
	Role                string            `json:"role"`
	PowerState          string            `json:"powerState"`
	SizeBytes           *uint64           `json:"sizeBytes"`
	Temperature         *float64          `json:"temperature"`
	Capacity            *storage.Capacity `json:"capacity"`
	ReadBytesPerSecond  *float64          `json:"readBytesPerSecond"`
	WriteBytesPerSecond *float64          `json:"writeBytesPerSecond"`
}

type ParityReport struct {
	State    string   `json:"state"`
	Progress *float64 `json:"progress"`
}

type StorageReport struct {
	Module
	Array  storage.Array `json:"array"`
	Parity ParityReport  `json:"parity"`
	Pools  []PoolReport  `json:"pools"`
	Disks  []DiskReport  `json:"disks"`
}

type DockerReport struct {
	Module
	Count   int            `json:"count"`
	Summary docker.Summary `json:"summary"`
}

type VMReport struct {
	Module
	Count                int        `json:"count"`
	Summary              vm.Summary `json:"summary"`
	VCPUAvailableCount   int        `json:"vcpuAvailableCount"`
	MemoryAvailableCount int        `json:"memoryAvailableCount"`
}

type Mount struct {
	Source           string `json:"source"`
	Target           string `json:"target"`
	Enabled          bool   `json:"enabled"`
	IntendedMode     string `json:"intendedMode"`
	Permissions      string `json:"permissions"`
	ObservedMode     string `json:"observedMode"`
	Evidence         string `json:"evidence"`
	ReadOnlyVerified bool   `json:"readOnlyVerified"`
}

type Report struct {
	Version                string        `json:"version"`
	GeneratedAt            time.Time     `json:"generatedAt"`
	ReadOnly               bool          `json:"readOnly"`
	WriteVerified          bool          `json:"writeVerified"`
	Checks                 []Check       `json:"checks"`
	Mounts                 []Mount       `json:"mounts"`
	UnverifiedCapabilities []string      `json:"unverifiedCapabilities"`
	System                 SystemReport  `json:"system"`
	Storage                StorageReport `json:"storage"`
	Docker                 DockerReport  `json:"docker"`
	VM                     VMReport      `json:"vm"`
	internal               bool
}

// ExitCode evaluates required surfaces and enabled protocols, leaving encoding failures to WriteReport.
func (r Report) ExitCode() int {
	if r.internal {
		return 1
	}
	modules := []Module{r.System.Module, r.Storage.Module, r.Docker.Module, r.VM.Module}
	for _, m := range modules {
		if m.internal {
			return 1
		}
	}
	for _, check := range r.Checks {
		if check.Enabled && (check.Required || check.Path == DockerSocket || check.Path == LibvirtSocket) && !check.Available {
			return 2
		}
	}
	for _, m := range modules {
		if m.Enabled && !m.ProtocolPassed {
			return 2
		}
	}
	return 0
}

// WriteReport emits only the standalone report and returns the process outcome.
func WriteReport(out io.Writer, r Report) int {
	if err := json.NewEncoder(out).Encode(r); err != nil {
		return 1
	}
	return r.ExitCode()
}

// module converts collection outcomes to fixed, non-sensitive diagnostics.
func module(available bool, diagnostics []string, partial bool) Module {
	m := Module{Enabled: true, Available: available, ProtocolPassed: available && !partial, Status: "passed", Diagnostics: diagnostics}
	if m.Diagnostics == nil {
		m.Diagnostics = []string{}
	}
	if !available {
		m.Status = "failed"
		m.Diagnostics = append(m.Diagnostics, "collectionUnavailable")
	} else if partial {
		m.Status = "partial"
	}
	slices.Sort(m.Diagnostics)
	m.Diagnostics = slices.Compact(m.Diagnostics)
	return m
}

// enum prevents arbitrary provider strings from escaping the report whitelist.
func enum(value string, allowed ...string) string {
	for _, candidate := range allowed {
		if value == candidate {
			return value
		}
	}
	return "unknown"
}

var interfacePattern = regexp.MustCompile(`^(eth[0-9]+|eno[0-9]+|ens[0-9]+|enp[0-9]+s[0-9]+(f[0-9]+)?|bond[0-9]+|br[0-9]+|shim-br[0-9]+|wlan[0-9]+)$`)

// safeInterface allows conventional default-route names without exporting arbitrary provider metadata.
func safeInterface(name string) string {
	if len(name) <= 15 && interfacePattern.MatchString(name) {
		return name
	}
	return "unknown"
}

// failureDiagnostic maps known production failure classes without returning raw error text.
func failureDiagnostic(reason string) string {
	lower := strings.ToLower(reason)
	switch {
	case strings.Contains(lower, "timed out"), strings.Contains(lower, "deadline exceeded"):
		return "timeout"
	case strings.Contains(lower, "cancelled"), strings.Contains(lower, "canceled"):
		return "cancelled"
	case strings.HasPrefix(lower, "invalid "), strings.HasPrefix(lower, "missing or invalid "),
		strings.Contains(lower, "malformed"), strings.Contains(lower, "exceeds limits"):
		return "invalidData"
	case strings.Contains(lower, "permission denied"):
		return "permissionDenied"
	case strings.Contains(lower, "no such file"), strings.Contains(lower, "file does not exist"):
		return "surfaceMissing"
	case lower == "docker engine api version unsupported":
		return "apiVersionUnsupported"
	case lower == "docker engine api version unavailable":
		return "apiVersionUnavailable"
	case strings.HasPrefix(lower, "docker engine unavailable;"), strings.HasPrefix(lower, "vm provider unavailable;"):
		return "socketConnectionUnavailable"
	default:
		return "protocolUnavailable"
	}
}

// projectSystem omits host identity and raw diagnostic keys and values.
func projectSystem(s system.Snapshot) SystemReport {
	d := []string{}
	if !s.Available {
		d = append(d, failureDiagnostic(s.Reason))
	}
	if s.Available && s.UptimeSeconds == nil {
		d = append(d, "uptimeUnavailable")
	}
	for key := range s.Diagnostics {
		switch key {
		case "temperature":
			d = append(d, "temperatureUnavailable")
		case "network":
			d = append(d, "networkUnavailable")
		default:
			d = append(d, "optionalMetricUnavailable")
		}
	}
	m := module(s.Available, d, len(d) > 0)
	m.ProtocolPassed = s.Available
	return SystemReport{Module: m,
		UptimeSeconds: s.UptimeSeconds, CPUUsage: s.CPUUsage, CPUTemperature: s.CPUTemperature,
		MemoryUsedBytes: s.MemoryUsedBytes, MemoryTotalBytes: s.MemoryTotalBytes,
		NetworkRXRate: s.NetworkRXRate, NetworkTXRate: s.NetworkTXRate,
		NetworkInterface: safeInterface(s.NetworkInterface)}
}

// projectStorage exports numeric storage fields and approved state enums only.
func projectStorage(s storage.Snapshot) StorageReport {
	d := []string{}
	if !s.Available {
		d = append(d, failureDiagnostic(s.Reason))
	}
	if len(s.Diagnostics) > 0 {
		d = append(d, "storageDetailsIncomplete")
	}
	s.Array.State = enum(s.Array.State, "started", "stopped", "starting", "stopping")
	if s.Available && s.Array.State == "unknown" {
		d = append(d, "arrayStateUnavailable")
	}
	parityState := enum(s.Parity.State, "not_configured", "idle", "running", "paused")
	if s.Available && parityState == "unknown" {
		d = append(d, "parityStateUnavailable")
	}
	if s.Available && (parityState == "running" || parityState == "paused") && s.Parity.Progress == nil {
		d = append(d, "parityProgressUnavailable")
	}
	for _, pool := range s.Pools {
		if pool.State == "Mounted" && pool.Capacity == nil {
			d = append(d, "poolCapacityUnavailable")
		}
	}
	if s.Available && s.Array.State == "started" && s.Array.DiskCount > 0 && s.Array.Capacity == nil {
		d = append(d, "arrayCapacityUnavailable")
	}
	r := StorageReport{Module: module(s.Available, d, len(d) > 0), Array: s.Array,
		Parity: ParityReport{State: parityState, Progress: s.Parity.Progress},
		Pools:  []PoolReport{}, Disks: []DiskReport{}}
	for _, pool := range s.Pools {
		r.Pools = append(r.Pools, PoolReport{State: enum(pool.State, "Mounted", "Unmounted"), DiskCount: pool.DiskCount, Capacity: pool.Capacity})
	}
	for _, disk := range s.Disks {
		temperature := disk.Temperature
		if disk.PowerState == "standby" {
			temperature = nil
		}
		r.Disks = append(r.Disks, DiskReport{Role: enum(disk.Role, "data", "parity", "cache"),
			PowerState: enum(disk.PowerState, "active", "standby"), SizeBytes: disk.SizeBytes,
			Temperature: temperature, Capacity: disk.Capacity,
			ReadBytesPerSecond: disk.ReadBytesPerSecond, WriteBytesPerSecond: disk.WriteBytesPerSecond})
	}
	return r
}

// projectDocker preserves counts without container names, IDs, or telemetry content.
func projectDocker(s docker.Snapshot) DockerReport {
	protocolIncomplete := len(s.Diagnostics) > 0
	d := []string{}
	if !s.Available {
		d = append(d, failureDiagnostic(s.Reason))
	}
	for _, c := range s.Containers {
		if enum(c.State, "running", "created", "exited", "dead", "paused", "restarting", "removing") == "unknown" {
			protocolIncomplete = true
			d = append(d, "containerStateUnavailable")
		}
		for _, diagnostic := range c.Diagnostics {
			switch diagnostic {
			case "Container network counters unavailable":
				d = append(d, "networkCountersUnavailable")
			case "Container start time unavailable":
				d = append(d, "uptimeUnavailable")
			case "Container inspect unavailable":
				protocolIncomplete = true
				d = append(d, "inspectUnavailable")
			case "Container stats unavailable":
				protocolIncomplete = true
				d = append(d, "statsUnavailable")
			case "Container CPU counters unavailable", "Container memory counters unavailable":
				protocolIncomplete = true
				d = append(d, "resourceCountersUnavailable")
			default:
				protocolIncomplete = true
			}
		}
	}
	if protocolIncomplete {
		d = append(d, "dockerDetailsIncomplete")
	}
	m := module(s.Available, d, len(d) > 0)
	m.ProtocolPassed = s.Available && !protocolIncomplete
	return DockerReport{Module: m, Count: len(s.Containers), Summary: s.Summary}
}

// projectVM treats unsupported uptime as informational but missing assigned resources as partial.
func projectVM(s vm.Snapshot) VMReport {
	r := VMReport{Count: len(s.Domains), Summary: s.Summary}
	partial := len(s.Diagnostics) > 0
	d := []string{}
	uptimeUnavailable := false
	for _, domain := range s.Domains {
		if enum(domain.State, "running", "blocked", "paused", "shutdown", "shutoff", "crashed", "pmsuspended") == "unknown" {
			partial = true
			d = append(d, "vmStateUnavailable")
		}
		if domain.VCPUs != nil {
			r.VCPUAvailableCount++
		} else {
			partial = true
			d = append(d, "vcpuUnavailable")
		}
		if domain.MemoryBytes != nil {
			r.MemoryAvailableCount++
		} else {
			partial = true
			d = append(d, "memoryUnavailable")
		}
		for _, diagnostic := range domain.Diagnostics {
			if diagnostic == "Uptime unavailable; libvirt does not report a reliable boot timestamp" {
				uptimeUnavailable = true
			} else {
				partial = true
			}
		}
	}
	if !s.Available {
		d = append(d, failureDiagnostic(s.Reason))
	}
	if partial {
		d = append(d, "vmDetailsIncomplete")
	}
	if uptimeUnavailable {
		d = append(d, "uptimeUnverified")
	}
	r.Module = module(s.Available, d, partial)
	return r
}
