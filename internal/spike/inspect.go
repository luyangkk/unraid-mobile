// Package spike verifies that a privileged container can safely read the host
// surfaces required by the MVP. It never writes to, starts, or stops a host
// resource.
package spike

import "sort"

const (
	HostProcStat    = "/host/proc/stat"
	HostProcMemInfo = "/host/proc/meminfo"
	HostProcNetDev  = "/host/proc/1/net/dev"
	HostSysThermal  = "/host/sys/class/thermal"
	DockerSocket    = "/var/run/docker.sock"
	LibvirtSocket   = "/var/run/libvirt/libvirt-sock"
	UnraidStatePath = "/host/var/local/emhttp"
)

var RequiredSurfaces = []string{
	HostProcStat,
	HostProcMemInfo,
	HostProcNetDev,
	HostSysThermal,
	DockerSocket,
	LibvirtSocket,
	UnraidStatePath,
}

type Check struct {
	Path      string `json:"path"`
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
}

type Report struct {
	ReadOnly     bool    `json:"readOnly"`
	AllAvailable bool    `json:"allAvailable"`
	Checks       []Check `json:"checks"`
}

// Inspect runs a metadata-only availability check. stat must not be replaced by
// an implementation that has side effects.
func Inspect(stat func(path string) error) Report {
	checks := make([]Check, 0, len(RequiredSurfaces))
	allAvailable := true
	for _, path := range RequiredSurfaces {
		check := Check{Path: path, Available: true}
		if err := stat(path); err != nil {
			check.Available = false
			check.Error = err.Error()
			allAvailable = false
		}
		checks = append(checks, check)
	}
	sort.Slice(checks, func(i, j int) bool { return checks[i].Path < checks[j].Path })
	return Report{ReadOnly: true, AllAvailable: allAvailable, Checks: checks}
}
