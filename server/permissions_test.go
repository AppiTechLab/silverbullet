package server

import "testing"

// newTestPerms builds an in-memory permissions store (no disk persistence is
// exercised here) seeded with the given rules.
func newTestPerms(def Permission, rules map[string]map[string]string) *SpacePermissions {
	sp := NewSpacePermissions("", "admin")
	if def != "" {
		sp.SetDefaultPermission(def)
	}
	for folder, users := range rules {
		for u, p := range users {
			// Bypass validation noise for wildcard/system seeds in tests.
			if sp.store[folder] == nil {
				sp.store[folder] = map[string]string{}
			}
			sp.store[folder][u] = p
		}
	}
	return sp
}

func TestGetFolderPermission(t *testing.T) {
	cases := []struct {
		name     string
		def      Permission
		rules    map[string]map[string]string
		path     string
		user     string
		expected Permission
	}{
		{
			name:     "no rules, open default",
			path:     "Notes/foo.md",
			user:     "alice",
			expected: PermWrite,
		},
		{
			name:     "explicit user rule wins",
			rules:    map[string]map[string]string{"Finance": {"alice": "read"}},
			path:     "Finance/q1.md",
			user:     "alice",
			expected: PermRead,
		},
		{
			// Regression for the fail-open bug: a rule listing alice must not
			// silently grant write to everyone else.
			name:     "wildcard makes folder private",
			rules:    map[string]map[string]string{"Finance": {"*": "none", "alice": "write"}},
			path:     "Finance/q1.md",
			user:     "bob",
			expected: PermNone,
		},
		{
			name:     "wildcard listed user still gets their grant",
			rules:    map[string]map[string]string{"Finance": {"*": "none", "alice": "write"}},
			path:     "Finance/q1.md",
			user:     "alice",
			expected: PermWrite,
		},
		{
			// Regression for the broken-inheritance bug: a child folder with a
			// rule that doesn't mention the user must inherit the parent rule,
			// not fall through to the default.
			name: "child without user inherits parent",
			rules: map[string]map[string]string{
				"Finance":         {"alice": "read"},
				"Finance/Reports": {"bob": "write"},
			},
			path:     "Finance/Reports/q1.md",
			user:     "alice",
			expected: PermRead,
		},
		{
			name: "child rule overrides parent for listed user",
			rules: map[string]map[string]string{
				"Finance":         {"alice": "read"},
				"Finance/Reports": {"alice": "write"},
			},
			path:     "Finance/Reports/q1.md",
			user:     "alice",
			expected: PermWrite,
		},
		{
			name:     "deny by default hides unconfigured folders",
			def:      PermNone,
			path:     "Notes/foo.md",
			user:     "alice",
			expected: PermNone,
		},
		{
			name:     "deny by default carves out Library for the client",
			def:      PermNone,
			path:     "Library/Std/Widgets/Kanban.md",
			user:     "alice",
			expected: PermRead,
		},
		{
			name:     "deny by default carves out plug files",
			def:      PermNone,
			path:     "mermaid.plug.js",
			user:     "alice",
			expected: PermRead,
		},
		{
			name:     "explicit rule still overrides system carve-out",
			def:      PermNone,
			rules:    map[string]map[string]string{"Library": {"*": "none"}},
			path:     "Library/Secret.md",
			user:     "alice",
			expected: PermNone,
		},
		{
			name:     "empty username bypasses (single-user mode)",
			def:      PermNone,
			path:     "Finance/q1.md",
			user:     "",
			expected: PermWrite,
		},
		{
			name:     "headless system user bypasses",
			def:      PermNone,
			rules:    map[string]map[string]string{"Finance": {"*": "none"}},
			path:     "Finance/q1.md",
			user:     "headless",
			expected: PermWrite,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sp := newTestPerms(tc.def, tc.rules)
			got := sp.GetFolderPermission(tc.path, tc.user)
			if got != tc.expected {
				t.Fatalf("GetFolderPermission(%q, %q) = %q, want %q",
					tc.path, tc.user, got, tc.expected)
			}
		})
	}
}

func TestNilReceiverIsOpen(t *testing.T) {
	var sp *SpacePermissions
	if got := sp.GetFolderPermission("anything.md", "alice"); got != PermWrite {
		t.Fatalf("nil receiver = %q, want write", got)
	}
	if !sp.IsAdmin("alice") {
		t.Fatal("nil receiver should treat everyone as admin")
	}
}

func TestSetFolderPermissionValidation(t *testing.T) {
	sp := NewSpacePermissions("", "admin")
	if err := sp.SetFolderPermission("Finance", "alice", Permission("writ")); err == nil {
		t.Fatal("expected error for invalid permission, got nil")
	}
	if err := sp.SetFolderPermission("Finance", "alice", PermRead); err != nil {
		t.Fatalf("valid permission rejected: %v", err)
	}
	if got := sp.GetFolderPermission("Finance/x.md", "alice"); got != PermRead {
		t.Fatalf("after set, got %q, want read", got)
	}
}

func TestSetDefaultPermissionInvalidResets(t *testing.T) {
	sp := NewSpacePermissions("", "admin")
	sp.SetDefaultPermission(PermNone)
	sp.SetDefaultPermission(Permission("bogus")) // should reset to open
	if got := sp.GetFolderPermission("Notes/foo.md", "alice"); got != PermWrite {
		t.Fatalf("invalid default not reset: got %q, want write", got)
	}
}
