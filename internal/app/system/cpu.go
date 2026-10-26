package system

import (
	"slices"
	"time"
)

type CPUInfo struct {
	Model               *string  `json:"model"`
	ReportedFrequencyHz *float64 `json:"reportedFrequencyHz"`
	LogicalCPUCount     *int     `json:"logicalCPUCount"`
}

type CPULogicalProcessorRaw struct {
	ID          int
	Total, Idle uint64
	Available   bool
	Reason      string
}

type CPULogicalProcessorSnapshot struct {
	ID     int      `json:"id"`
	Usage  *float64 `json:"usage"`
	Reason string   `json:"reason,omitempty"`
}

type cpuBaseline struct {
	Total, Idle uint64
	At          time.Time
}

// cpuDelta accepts only ordered adjacent counters with a positive, valid total increment.
func cpuDelta(total, idle uint64, now time.Time, previous *cpuBaseline) (*float64, string) {
	if previous == nil {
		return nil, "Waiting for adjacent host CPU samples"
	}
	if !now.After(previous.At) {
		return nil, "Host CPU sample time did not advance"
	}
	if total < previous.Total || idle < previous.Idle {
		return nil, "Host CPU counters rolled back"
	}
	totalDelta, idleDelta := total-previous.Total, idle-previous.Idle
	if totalDelta == 0 || idleDelta > totalDelta {
		return nil, "Invalid host CPU counter increment"
	}
	value := 100 * float64(totalDelta-idleDelta) / float64(totalDelta)
	return &value, ""
}

// collectCPU maintains independent aggregate and logical baselines from current stat IDs.
func (s *Service) collectCPU(raw Raw, now time.Time, next *Snapshot) {
	next.CPUUsage, _ = cpuDelta(raw.CPUTotal, raw.CPUIdle, now, s.cpu)
	if s.cpu == nil || now.After(s.cpu.At) {
		s.cpu = &cpuBaseline{Total: raw.CPUTotal, Idle: raw.CPUIdle, At: now}
	} else {
		s.cpu = nil
	}
	next.CPUInfo = cloneCPUInfo(raw.CPUInfo)
	items := slices.Clone(raw.CPULogicalProcessors)
	slices.SortFunc(items, func(a, b CPULogicalProcessorRaw) int { return a.ID - b.ID })
	baselines := make(map[int]cpuBaseline, len(items))
	for _, item := range items {
		row := CPULogicalProcessorSnapshot{ID: item.ID, Reason: item.Reason}
		if item.Available {
			var previous *cpuBaseline
			if baseline, found := s.logicalCPU[item.ID]; found {
				previous = &baseline
			}
			row.Usage, row.Reason = cpuDelta(item.Total, item.Idle, now, previous)
			if previous == nil || now.After(previous.At) {
				baselines[item.ID] = cpuBaseline{Total: item.Total, Idle: item.Idle, At: now}
			}
		} else {
			if row.Reason == "" {
				row.Reason = "Host logical CPU counters unavailable"
			}
			next.Diagnostics["cpuLogicalProcessors"] = "Some host logical CPU counters are unavailable"
		}
		next.CPULogicalProcessors = append(next.CPULogicalProcessors, row)
	}
	s.logicalCPU = baselines
	if len(items) > 0 {
		if next.CPUInfo == nil {
			next.CPUInfo = &CPUInfo{}
		}
		count := len(items)
		next.CPUInfo.LogicalCPUCount = &count
	} else {
		if next.CPUInfo != nil {
			next.CPUInfo.LogicalCPUCount = nil
		}
		next.Diagnostics["cpuLogicalProcessors"] = "No host logical CPU counters"
	}
}

// cloneCPUInfo isolates both the metadata object and each optional scalar.
func cloneCPUInfo(info *CPUInfo) *CPUInfo {
	if info == nil {
		return nil
	}
	return &CPUInfo{Model: copyPointer(info.Model), ReportedFrequencyHz: copyPointer(info.ReportedFrequencyHz),
		LogicalCPUCount: copyPointer(info.LogicalCPUCount)}
}
