package auth

import (
	"encoding/json"
	"errors"
	"os"
	"sync"

	"github.com/Himanshuplace/nats-ui/pkg/types"
)

// ConnectionStore persists NATS connection profiles to a JSON file on disk.
type ConnectionStore struct {
	path string
	mu   sync.Mutex
}

func NewConnectionStore(path string) *ConnectionStore {
	return &ConnectionStore{path: path}
}

// Load reads all saved connection profiles from disk.
// Returns nil, nil if the file doesn't exist yet.
func (s *ConnectionStore) Load() ([]types.ConnectionProfile, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var profiles []types.ConnectionProfile
	return profiles, json.Unmarshal(data, &profiles)
}

// Save writes the given profiles to disk, replacing any previous file.
func (s *ConnectionStore) Save(profiles []types.ConnectionProfile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	data, err := json.MarshalIndent(profiles, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.path, data, 0600)
}
