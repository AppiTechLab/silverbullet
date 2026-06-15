package server

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

const usersFileName = "_users.json"

// UserRecord is the persisted form of a user account. Admin status is NOT stored
// here — it is governed by the _permissions.json "_admin" folder (see
// SpacePermissions) so there is a single source of truth for admin rights.
type UserRecord struct {
	PasswordHash string `json:"passwordHash"`
	Disabled     bool   `json:"disabled,omitempty"`
	Created      string `json:"created,omitempty"`
}

// PublicUser is the API-facing shape of an account (never includes the hash).
type PublicUser struct {
	Username string `json:"username"`
	Disabled bool   `json:"disabled"`
	Created  string `json:"created,omitempty"`
}

// SpaceUsers is a runtime, persisted user store backed by _users.json at the
// space root. It is safe for concurrent use. The store lets an admin manage
// accounts (create, set password, disable, delete) without restarting the
// server, unlike the SB_USER / SB_USERS env vars which only seed it.
type SpaceUsers struct {
	mu        sync.RWMutex
	spacePath string
	store     map[string]UserRecord // username -> record
}

// NewSpaceUsers creates an empty in-memory store. Call Load() then Seed().
func NewSpaceUsers(spacePath string) *SpaceUsers {
	return &SpaceUsers{
		spacePath: spacePath,
		store:     make(map[string]UserRecord),
	}
}

func (su *SpaceUsers) filePath() string {
	return filepath.Join(su.spacePath, usersFileName)
}

// Load reads _users.json (if present) into the store, replacing its contents.
// A missing file is not an error. Call before Seed so env users only fill gaps.
func (su *SpaceUsers) Load() error {
	if su == nil {
		return nil
	}
	data, err := os.ReadFile(su.filePath())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	var loaded map[string]UserRecord
	if err := json.Unmarshal(data, &loaded); err != nil {
		return err
	}
	su.mu.Lock()
	su.store = loaded
	su.mu.Unlock()
	return nil
}

// Save writes the store to _users.json (mode 0600). The file is never served to
// clients and is hidden from file listings (see the file-serving layer).
func (su *SpaceUsers) Save() error {
	if su == nil {
		return nil
	}
	su.mu.RLock()
	data, err := json.MarshalIndent(su.store, "", "  ")
	su.mu.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(su.filePath(), data, 0600)
}

// Seed adds users parsed from SB_USER / SB_USERS that are not already present in
// the store. Existing (file-loaded) entries are never overwritten, so password
// changes made through the panel survive restarts. Env users act purely as a
// bootstrap. Note: a user removed via the panel but still listed in the env will
// be re-added on the next restart — remove it from the env to delete it for good.
func (su *SpaceUsers) Seed(users map[string]UserEntry) {
	if su == nil {
		return
	}
	su.mu.Lock()
	defer su.mu.Unlock()
	now := time.Now().UTC().Format(time.RFC3339)
	for name, e := range users {
		if _, ok := su.store[name]; ok {
			continue
		}
		su.store[name] = UserRecord{PasswordHash: e.PasswordHash, Created: now}
	}
}

// Authenticate verifies a username/password against the store, rejecting unknown
// and disabled accounts. Safe on a nil receiver (returns false).
func (su *SpaceUsers) Authenticate(username, password string) bool {
	if su == nil {
		return false
	}
	su.mu.RLock()
	rec, ok := su.store[username]
	su.mu.RUnlock()
	if !ok || rec.Disabled {
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(rec.PasswordHash), []byte(password)) == nil
}

// validUsername rejects empty, reserved, and structurally-invalid usernames.
func validUsername(name string) error {
	if name == "" {
		return fmt.Errorf("username is required")
	}
	switch name {
	case "*", "_admin", "headless":
		return fmt.Errorf("username %q is reserved", name)
	}
	for _, r := range name {
		if r <= ' ' || r == ':' || r == '/' || r == '\\' || r == ',' {
			return fmt.Errorf("username contains an invalid character")
		}
	}
	return nil
}

func hashPassword(pw string) (string, error) {
	if pw == "" {
		return "", fmt.Errorf("password is required")
	}
	h, err := bcrypt.GenerateFromPassword([]byte(pw), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// Create adds a new user. Fails if the username is invalid or already exists.
func (su *SpaceUsers) Create(username, password string) error {
	if su == nil {
		return fmt.Errorf("user store unavailable")
	}
	if err := validUsername(username); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	su.mu.Lock()
	if _, ok := su.store[username]; ok {
		su.mu.Unlock()
		return fmt.Errorf("user %q already exists", username)
	}
	su.store[username] = UserRecord{
		PasswordHash: hash,
		Created:      time.Now().UTC().Format(time.RFC3339),
	}
	su.mu.Unlock()
	return su.Save()
}

// SetPassword replaces a user's password.
func (su *SpaceUsers) SetPassword(username, password string) error {
	if su == nil {
		return fmt.Errorf("user store unavailable")
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	su.mu.Lock()
	rec, ok := su.store[username]
	if !ok {
		su.mu.Unlock()
		return fmt.Errorf("user %q not found", username)
	}
	rec.PasswordHash = hash
	su.store[username] = rec
	su.mu.Unlock()
	return su.Save()
}

// SetDisabled enables or disables a user. A disabled user cannot authenticate.
func (su *SpaceUsers) SetDisabled(username string, disabled bool) error {
	if su == nil {
		return fmt.Errorf("user store unavailable")
	}
	su.mu.Lock()
	rec, ok := su.store[username]
	if !ok {
		su.mu.Unlock()
		return fmt.Errorf("user %q not found", username)
	}
	rec.Disabled = disabled
	su.store[username] = rec
	su.mu.Unlock()
	return su.Save()
}

// Delete removes a user from the store (no-op if absent).
func (su *SpaceUsers) Delete(username string) error {
	if su == nil {
		return nil
	}
	su.mu.Lock()
	delete(su.store, username)
	su.mu.Unlock()
	return su.Save()
}

// Exists reports whether the username is present in the store.
func (su *SpaceUsers) Exists(username string) bool {
	if su == nil {
		return false
	}
	su.mu.RLock()
	defer su.mu.RUnlock()
	_, ok := su.store[username]
	return ok
}

// List returns all users (without password hashes), sorted by username.
func (su *SpaceUsers) List() []PublicUser {
	if su == nil {
		return nil
	}
	su.mu.RLock()
	defer su.mu.RUnlock()
	out := make([]PublicUser, 0, len(su.store))
	for name, rec := range su.store {
		out = append(out, PublicUser{
			Username: name,
			Disabled: rec.Disabled,
			Created:  rec.Created,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Username < out[j].Username })
	return out
}
