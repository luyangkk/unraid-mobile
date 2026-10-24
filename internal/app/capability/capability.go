// Package capability describes what the current Unraid host can safely expose.
package capability

// Set is the complete set of capabilities returned to the client at startup.
type Set struct {
	Docker        bool          `json:"docker"`
	DockerActions DockerActions `json:"dockerActions"`
	VM            bool          `json:"vm"`
	VMActions     VMActions     `json:"vmActions"`
	Array         Array         `json:"array"`
	Parity        Parity        `json:"parity"`
	Storage       Storage       `json:"storage"`
}

type DockerActions struct {
	Start   bool `json:"start"`
	Stop    bool `json:"stop"`
	Restart bool `json:"restart"`
}

type VMActions struct {
	Start     bool `json:"start"`
	Stop      bool `json:"stop"`
	ForceStop bool `json:"forceStop"`
}

type Array struct {
	Read  bool `json:"read"`
	Start bool `json:"start"`
	Stop  bool `json:"stop"`
}

type Parity struct {
	Read   bool `json:"read"`
	Start  bool `json:"start"`
	Cancel bool `json:"cancel"`
}

type Storage struct {
	Read        bool `json:"read"`
	Temperature bool `json:"temperature"`
	IO          bool `json:"io"`
}

// Allows reports whether a public operation is currently available. Unknown
// resources and actions are deliberately denied.
func (s Set) Allows(resource, action string) bool {
	switch resource {
	case "docker":
		return s.Docker && ((action == "start" && s.DockerActions.Start) ||
			(action == "stop" && s.DockerActions.Stop) ||
			(action == "restart" && s.DockerActions.Restart))
	case "vm":
		return s.VM && ((action == "start" && s.VMActions.Start) ||
			(action == "stop" && s.VMActions.Stop) ||
			(action == "force-stop" && s.VMActions.ForceStop))
	case "array":
		return (action == "start" && s.Array.Start) || (action == "stop" && s.Array.Stop)
	case "parity":
		return (action == "start" && s.Parity.Start) || (action == "cancel" && s.Parity.Cancel)
	default:
		return false
	}
}
