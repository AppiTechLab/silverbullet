package server

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSpaceUsersCRUDAndAuth(t *testing.T) {
	dir := t.TempDir()
	su := NewSpaceUsers(dir)

	// Seed from "env" users (bootstrap).
	su.Seed(map[string]UserEntry{
		"alice": {Username: "alice", PasswordHash: mustHash(t, "secret")},
	})
	if !su.Exists("alice") {
		t.Fatal("seeded user alice should exist")
	}
	if !su.Authenticate("alice", "secret") {
		t.Fatal("alice should authenticate with seeded password")
	}
	if su.Authenticate("alice", "wrong") {
		t.Fatal("wrong password must fail")
	}

	// Seed must not overwrite an existing user.
	su.Seed(map[string]UserEntry{
		"alice": {Username: "alice", PasswordHash: mustHash(t, "other")},
	})
	if su.Authenticate("alice", "other") {
		t.Fatal("Seed must not overwrite an existing user's password")
	}

	// Create a new user at runtime.
	if err := su.Create("bob", "pw"); err != nil {
		t.Fatalf("create bob: %v", err)
	}
	if !su.Authenticate("bob", "pw") {
		t.Fatal("bob should authenticate")
	}
	if err := su.Create("bob", "again"); err == nil {
		t.Fatal("creating a duplicate user should fail")
	}
	for _, bad := range []string{"", "*", "_admin", "headless", "a:b", "a/b"} {
		if err := su.Create(bad, "pw"); err == nil {
			t.Fatalf("create with invalid username %q should fail", bad)
		}
	}

	// Change password.
	if err := su.SetPassword("bob", "newpw"); err != nil {
		t.Fatalf("set password: %v", err)
	}
	if su.Authenticate("bob", "pw") || !su.Authenticate("bob", "newpw") {
		t.Fatal("password change did not take effect")
	}

	// Disable / enable.
	if err := su.SetDisabled("bob", true); err != nil {
		t.Fatalf("disable: %v", err)
	}
	if su.Authenticate("bob", "newpw") {
		t.Fatal("disabled user must not authenticate")
	}
	if err := su.SetDisabled("bob", false); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if !su.Authenticate("bob", "newpw") {
		t.Fatal("re-enabled user should authenticate")
	}

	// List is sorted and hides hashes.
	list := su.List()
	if len(list) != 2 || list[0].Username != "alice" || list[1].Username != "bob" {
		t.Fatalf("unexpected list: %+v", list)
	}

	// Delete.
	if err := su.Delete("bob"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if su.Exists("bob") || su.Authenticate("bob", "newpw") {
		t.Fatal("deleted user should be gone")
	}
}

func TestSpaceUsersPersistence(t *testing.T) {
	dir := t.TempDir()
	su := NewSpaceUsers(dir)
	su.Seed(map[string]UserEntry{"alice": {Username: "alice", PasswordHash: mustHash(t, "secret")}})
	if err := su.Save(); err != nil {
		t.Fatalf("save: %v", err)
	}
	if err := su.Create("bob", "pw"); err != nil {
		t.Fatalf("create: %v", err)
	}

	// _users.json should exist and be private.
	info, err := os.Stat(filepath.Join(dir, usersFileName))
	if err != nil {
		t.Fatalf("stat users file: %v", err)
	}
	if perm := info.Mode().Perm(); perm != 0600 {
		t.Fatalf("users file mode = %o, want 600", perm)
	}

	// A fresh store loads the persisted users.
	su2 := NewSpaceUsers(dir)
	if err := su2.Load(); err != nil {
		t.Fatalf("load: %v", err)
	}
	if !su2.Authenticate("alice", "secret") || !su2.Authenticate("bob", "pw") {
		t.Fatal("persisted users should authenticate after reload")
	}
}

func mustHash(t *testing.T, pw string) string {
	t.Helper()
	h, err := hashPassword(pw)
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	return h
}
