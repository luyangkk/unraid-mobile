// Package operation owns the lifecycle of asynchronous host operations.
package operation

import (
	"errors"
	"fmt"
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
	Progress  *float64   `json:"progress,omitempty"`
	Error     *Error     `json:"error,omitempty"`
}

// Store is safe for concurrent API handlers. It keeps only in-memory state;
// callers recover authoritative resource state from adapters after a restart.
type Store struct {
	mu         sync.RWMutex
	now        func() time.Time
	nextID     uint64
	operations map[string]Operation
	resources  map[string]string
}

func NewStore(now func() time.Time) *Store {
	return &Store{
		now:        now,
		operations: make(map[string]Operation),
		resources:  make(map[string]string),
	}
}

func (s *Store) Create(operationType, resource string) (Operation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.resources[resource]; exists {
		return Operation{}, ErrResourceBusy
	}
	s.nextID++
	op := Operation{
		ID:        fmt.Sprintf("op_%d", s.nextID),
		Type:      operationType,
		Resource:  resource,
		State:     Pending,
		StartedAt: s.now().UTC(),
	}
	s.operations[op.ID] = op
	s.resources[resource] = op.ID
	return op, nil
}

func (s *Store) Get(id string) (Operation, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	op, ok := s.operations[id]
	return op, ok
}

func (s *Store) Update(id string, next State, operationError *Error) (Operation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	op, ok := s.operations[id]
	if !ok {
		return Operation{}, ErrOperationNotFound
	}
	if !canTransition(op.State, next) {
		return Operation{}, ErrInvalidTransition
	}
	op.State = next
	op.Error = operationError
	if isTerminal(next) {
		endedAt := s.now().UTC()
		op.EndedAt = &endedAt
		delete(s.resources, op.Resource)
	}
	s.operations[id] = op
	return op, nil
}

func canTransition(from, to State) bool {
	return (from == Pending && to == Running) ||
		(from == Running && (to == Success || to == Failed || to == Cancelled))
}

func isTerminal(state State) bool {
	return state == Success || state == Failed || state == Cancelled
}
