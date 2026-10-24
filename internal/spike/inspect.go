// Package spike probes production read capabilities without mutating host resources.
package spike

import "sort"

const (
	HostProcStat    = "/host/proc/stat"
	HostProcMemInfo = "/host/proc/meminfo"
	HostProcUptime  = "/host/proc/uptime"
	HostProcRoute   = "/host/proc/1/net/route"
	HostProcNetDev  = "/host/proc/1/net/dev"
	HostDiskStats   = "/host/proc/diskstats"
	HostSysThermal  = "/host/sys/class/thermal"
	HostSysHwmon    = "/host/sys/class/hwmon"
	DockerSocket    = "/var/run/docker.sock"
	LibvirtSocket   = "/var/run/libvirt/libvirt-sock-ro"
	UnraidStatePath = "/host/var/local/emhttp"
)

var RequiredSurfaces = []string{
	HostProcStat,
	HostProcMemInfo,
	HostDiskStats,
	UnraidStatePath + "/disks.ini",
	UnraidStatePath + "/var.ini",
}

type Check struct {
	Path      string `json:"path"`
	Required  bool   `json:"required"`
	Enabled   bool   `json:"enabled"`
	Available bool   `json:"available"`
	Error     string `json:"error,omitempty"`
}

// Inspect runs a metadata-only availability check. stat must not be replaced by
// an implementation that has side effects.
func Inspect(stat func(path string) error) Report {
	checks := make([]Check, 0, len(RequiredSurfaces))
	for _, path := range RequiredSurfaces {
		check := Check{Path: path, Required: true, Enabled: true, Available: true}
		if err := stat(path); err != nil {
			check.Available = false
			check.Error = "surfaceUnavailable"
		}
		checks = append(checks, check)
	}
	sort.Slice(checks, func(i, j int) bool { return checks[i].Path < checks[j].Path })
	return Report{ReadOnly: true, Checks: checks}
}
