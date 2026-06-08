package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const permissionsFileName = "_permissions.json"

// Permission levels. The zero value is not valid; use DefaultPermission for
// "no rule found".
type Permission string

const (
	PermWrite         = Permission("write")
	PermRead          = Permission("read")
	PermNone          = Permission("none")
	DefaultPermission = PermWrite // open by default
)

// SpacePermissions manages folder-level access control for a space.
// It is safe for concurrent use.
type SpacePermissions struct {
	mu        sync.RWMutex
	spacePath string
	// store: folder-path → username → permission string
	store map[string]map[string]string
}

// NewSpacePermissions creates an in-memory permissions store for the given
// space path and seeds the _admin folder with adminUser (if non-empty).
// Call Load() afterwards to merge any persisted rules.
func NewSpacePermissions(spacePath, adminUser string) *SpacePermissions {
	sp := &SpacePermissions{
		spacePath: spacePath,
		store:     make(map[string]map[string]string),
	}
	if adminUser != "" {
		sp.store["_admin"] = map[string]string{adminUser: string(PermWrite)}
	}
	return sp
}

func (sp *SpacePermissions) filePath() string {
	return filepath.Join(sp.spacePath, permissionsFileName)
}

// Load reads _permissions.json from the space root and merges it into the
// in-memory store. The default _admin entry is kept if the file omits it.
func (sp *SpacePermissions) Load() error {
	if sp == nil {
		return nil
	}
	data, err := os.ReadFile(sp.filePath())
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}

	var loaded map[string]map[string]string
	if err := json.Unmarshal(data, &loaded); err != nil {
		return err
	}

	sp.mu.Lock()
	defer sp.mu.Unlock()

	// Preserve the default _admin seed when the file doesn't override it.
	savedAdmin := sp.store["_admin"]
	sp.store = loaded
	if _, ok := sp.store["_admin"]; !ok && savedAdmin != nil {
		sp.store["_admin"] = savedAdmin
	}
	return nil
}

// Save writes the current store to _permissions.json (mode 0600).
func (sp *SpacePermissions) Save() error {
	if sp == nil {
		return nil
	}
	sp.mu.RLock()
	data, err := json.MarshalIndent(sp.store, "", "  ")
	sp.mu.RUnlock()
	if err != nil {
		return err
	}
	return os.WriteFile(sp.filePath(), data, 0600)
}

// GetFolderPermission returns the effective permission for filePath / username.
// It tries the longest matching folder prefix first, then progressively shorter
// ones, and finally falls back to DefaultPermission.
// A nil receiver or empty username always returns PermWrite (no restrictions).
func (sp *SpacePermissions) GetFolderPermission(filePath, username string) Permission {
	if sp == nil || username == "" {
		return PermWrite
	}
	// Headless system user bypasses all folder restrictions.
	if username == "headless" {
		return PermWrite
	}

	sp.mu.RLock()
	defer sp.mu.RUnlock()

	// Normalise separators and try longest prefix first.
	filePath = filepath.ToSlash(filePath)
	parts := strings.Split(filePath, "/")
	for i := len(parts) - 1; i >= 1; i-- {
		folder := strings.Join(parts[:i], "/")
		if folderPerms, ok := sp.store[folder]; ok {
			if perm, ok := folderPerms[username]; ok {
				return Permission(perm)
			}
			// Folder rule exists but user not listed → open default.
			return DefaultPermission
		}
	}
	return DefaultPermission
}

// SetFolderPermission persists a single folder/user/permission triple.
func (sp *SpacePermissions) SetFolderPermission(folder, username string, perm Permission) error {
	if sp == nil {
		return nil
	}
	sp.mu.Lock()
	if _, ok := sp.store[folder]; !ok {
		sp.store[folder] = make(map[string]string)
	}
	sp.store[folder][username] = string(perm)
	sp.mu.Unlock()
	return sp.Save()
}

// DeleteFolderUser removes a single user entry from a folder rule and
// removes the folder entry altogether when it becomes empty.
func (sp *SpacePermissions) DeleteFolderUser(folder, username string) error {
	if sp == nil {
		return nil
	}
	sp.mu.Lock()
	if perms, ok := sp.store[folder]; ok {
		delete(perms, username)
		if len(perms) == 0 {
			delete(sp.store, folder)
		}
	}
	sp.mu.Unlock()
	return sp.Save()
}

// DeleteFolder removes all rules for a folder.
func (sp *SpacePermissions) DeleteFolder(folder string) error {
	if sp == nil {
		return nil
	}
	sp.mu.Lock()
	delete(sp.store, folder)
	sp.mu.Unlock()
	return sp.Save()
}

// IsAdmin reports whether username has write access to the virtual _admin folder.
// A nil receiver (no auth) returns true — everyone is admin in that mode.
func (sp *SpacePermissions) IsAdmin(username string) bool {
	if sp == nil {
		return true
	}
	if username == "" {
		return false
	}
	sp.mu.RLock()
	defer sp.mu.RUnlock()
	if perms, ok := sp.store["_admin"]; ok {
		return perms[username] == string(PermWrite)
	}
	return false
}

// GetAll returns a deep copy of the full permissions store (including _admin).
func (sp *SpacePermissions) GetAll() map[string]map[string]string {
	if sp == nil {
		return make(map[string]map[string]string)
	}
	sp.mu.RLock()
	defer sp.mu.RUnlock()
	result := make(map[string]map[string]string, len(sp.store))
	for folder, perms := range sp.store {
		cp := make(map[string]string, len(perms))
		for u, p := range perms {
			cp[u] = p
		}
		result[folder] = cp
	}
	return result
}
