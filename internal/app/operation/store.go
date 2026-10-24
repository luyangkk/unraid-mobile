// Package operation owns the lifecycle of asynchronous host operations.
package operation

import (
	"errors"
	"fmt"
	"math"
	"sync"
	"time"
)

type State string

const (
	Pending   State = "pending"
	Running   State = "running"
	Success   State = "success"
	Failed    State = "failed"
	Cancelled State = "cancelled"
)

var (
	ErrResourceBusy      = errors.New("resource already has a running operation")
	ErrOperationNotFound = errors.New("operation not found")
	ErrInvalidTransition = errors.New("invalid operation transition")
	ErrInvalidProgress   = errors.New("operation progress must be finite and between 0 and 100")
)

type Error struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Details   string `json:"details,omitempty"`
	Retryable bool   `json:"retryable"`
}

type Operation struct {
	ID        string     `json:"id"`
	Type      string     `json:"type"`
	Resource  string     `json:"resource"`
	State     State      `json:"state"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
	Progress  *float64   `json:"progress"`
	Error     *Error     `json:"error,omitempty"`
}

// Store is safe for concurrent API handlers. It keeps only in-memory state;
// callers recover authoritative resource state from adapters after a restart.
type Store struct {
	mu          sync.Mutex
	now         func() time.Time
	nextID      uint64
	operations  map[string]Operation
	resources   map[string]string
	terminals   []terminalRecord
	subscribers map[chan Operation]struct{}
	wake        chan struct{}
}

// NewStore starts with no operations; the injected clock controls all timestamps.
func NewStore(now func() time.Time) *Store {
	return &Store{
		now:         now,
		operations:  make(map[string]Operation),
		resources:   make(map[string]string),
		subscribers: make(map[chan Operation]struct{}),
		wake:        make(chan struct{}, 1),
	}
}

// Create reserves a resource until the new pending operation reaches a terminal state.
func (s *Store) Create(operationType, resource string) (Operation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	s.prune(now)

	if _, exists := s.resources[resource]; exists {
		return Operation{}, ErrResourceBusy
	}
	s.nextID++
	op := Operation{
		ID:        fmt.Sprintf("op_%d", s.nextID),
		Type:      operationType,
		Resource:  resource,
		State:     Pending,
		StartedAt: now,
	}
	s.operations[op.ID] = op
	s.resources[resource] = op.ID
	s.publish(op)
	return clone(op), nil
}

// Get returns an isolated snapshot, or false for unknown or expired operations.
func (s *Store) Get(id string) (Operation, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(s.now().UTC())
	op, ok := s.operations[id]
	return clone(op), ok
}

// Update advances the lifecycle without executing any host action.
func (s *Store) Update(id string, next State, operationError *Error) (Operation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.now().UTC()
	s.prune(now)

	op, ok := s.operations[id]
	if !ok {
		return Operation{}, ErrOperationNotFound
	}
	if !canTransition(op.State, next) {
		return Operation{}, ErrInvalidTransition
	}
	op.State = next
	if next == Failed && operationError != nil {
		copiedError := *operationError
		op.Error = &copiedError
	} else {
		op.Error = nil
	}
	if isTerminal(next) {
		endedAt := now
		op.EndedAt = &endedAt
		delete(s.resources, op.Resource)
		s.retain(terminalRecord{id: op.ID, endedAt: endedAt})
	}
	s.operations[id] = op
	s.prune(now)
	s.publish(op)
	if isTerminal(next) {
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
	return clone(op), nil
}

// UpdateProgress replaces running progress; nil represents an unknown percentage.
func (s *Store) UpdateProgress(id string, progress *float64) (Operation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prune(s.now().UTC())
	op, ok := s.operations[id]
	if !ok {
		return Operation{}, ErrOperationNotFound
	}
	if op.State != Running {
		return Operation{}, ErrInvalidTransition
	}
	if progress != nil && (math.IsNaN(*progress) || math.IsInf(*progress, 0) || *progress < 0 || *progress > 100) {
		return Operation{}, ErrInvalidProgress
	}
	if progress == nil && op.Progress == nil || progress != nil && op.Progress != nil && *progress == *op.Progress {
		return clone(op), nil
	}
	op.Progress = nil
	if progress != nil {
		value := *progress
		op.Progress = &value
	}
	s.operations[id] = op
	s.publish(op)
	return clone(op), nil
}

// clone gives every caller and subscriber ownership of all optional fields.
func clone(op Operation) Operation {
	if op.EndedAt != nil {
		value := *op.EndedAt
		op.EndedAt = &value
	}
	if op.Progress != nil {
		value := *op.Progress
		op.Progress = &value
	}
	if op.Error != nil {
		value := *op.Error
		op.Error = &value
	}
	return op
}

// canTransition permits only the explicit pending/running lifecycle edges.
func canTransition(from, to State) bool {
	return (from == Pending && to == Running) ||
		(from == Running && (to == Success || to == Failed || to == Cancelled))
}

// isTerminal identifies immutable outcomes that release their resource.
func isTerminal(state State) bool {
	return state == Success || state == Failed || state == Cancelled
}
