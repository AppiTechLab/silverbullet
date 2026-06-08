package server

import (
	"fmt"
	"log"
	"os"
	"sort"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

// UserEntry holds a username and its bcrypt-ready password hash.
type UserEntry struct {
	Username     string
	PasswordHash string // always a bcrypt hash, even when input was plaintext
	IsPlaintext  bool   // true when the original credential was plaintext (warn only)
}

// ParseUsers reads SB_USER and SB_USERS, validates each entry, and returns:
//   - users: map from username to UserEntry (password already hashed)
//   - credStrings: sorted "username:original_input" strings used as a stable
//     representation in AuthOptions for JWT-invalidation-on-change detection
//
// Both "username:plaintext" and "username:$2b$..." / "username:$2a$..." formats
// are accepted. Plaintext passwords are hashed at startup and logged as warnings.
func ParseUsers() (users map[string]UserEntry, credStrings []string, err error) {
	users = make(map[string]UserEntry)

	var sources []string
	if v := os.Getenv("SB_USER"); v != "" {
		sources = append(sources, v)
	}
	if v := os.Getenv("SB_USERS"); v != "" {
		for _, s := range strings.Split(v, ",") {
			if s = strings.TrimSpace(s); s != "" {
				sources = append(sources, s)
			}
		}
	}

	for _, entry := range sources {
		colonIdx := strings.Index(entry, ":")
		if colonIdx == -1 {
			return nil, nil, fmt.Errorf("invalid user entry (missing ':'): %q", entry)
		}
		username := entry[:colonIdx]
		password := entry[colonIdx+1:]
		if username == "" || password == "" {
			return nil, nil, fmt.Errorf("invalid user entry (empty username or password): %q", entry)
		}

		isBcrypt := strings.HasPrefix(password, "$2b$") || strings.HasPrefix(password, "$2a$")

		var hash string
		if isBcrypt {
			hash = password
		} else {
			log.Printf("[auth] Warning: plaintext password for user '%s'. Use a bcrypt hash for security (see scripts/hash_password.go).", username)
			h, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
			if err != nil {
				return nil, nil, fmt.Errorf("bcrypt error for user %q: %w", username, err)
			}
			hash = string(h)
		}

		users[username] = UserEntry{
			Username:     username,
			PasswordHash: hash,
			IsPlaintext:  !isBcrypt,
		}
		// Store the original input string for stable change detection.
		// Using the original value (not the computed hash) ensures the same
		// credentials always produce the same AuthOptions hash across restarts.
		credStrings = append(credStrings, entry)
	}

	sort.Strings(credStrings)
	return users, credStrings, nil
}

// BuildAuthorizer returns a UserPasswordAuthorizer that validates credentials
// using bcrypt.CompareHashAndPassword.
func BuildAuthorizer(users map[string]UserEntry) UserPasswordAuthorizer {
	return func(username, password string) bool {
		entry, ok := users[username]
		if !ok {
			return false
		}
		return bcrypt.CompareHashAndPassword([]byte(entry.PasswordHash), []byte(password)) == nil
	}
}
