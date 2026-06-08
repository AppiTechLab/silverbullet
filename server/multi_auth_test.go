package server

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"
)

func TestParseUsers_PlaintextWarns(t *testing.T) {
	t.Setenv("SB_USER", "alice:secret")
	t.Setenv("SB_USERS", "")

	users, creds, err := ParseUsers()
	require.NoError(t, err)
	assert.Len(t, users, 1)
	assert.Len(t, creds, 1)

	entry := users["alice"]
	assert.Equal(t, "alice", entry.Username)
	assert.True(t, entry.IsPlaintext)
	assert.NoError(t, bcrypt.CompareHashAndPassword([]byte(entry.PasswordHash), []byte("secret")))
}

func TestParseUsers_BcryptHash(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("hunter2"), bcrypt.MinCost)
	t.Setenv("SB_USER", "bob:"+string(hash))
	t.Setenv("SB_USERS", "")

	users, _, err := ParseUsers()
	require.NoError(t, err)

	entry := users["bob"]
	assert.False(t, entry.IsPlaintext)
	assert.Equal(t, string(hash), entry.PasswordHash)
}

func TestParseUsers_MultiUser(t *testing.T) {
	hashA, _ := bcrypt.GenerateFromPassword([]byte("passA"), bcrypt.MinCost)
	t.Setenv("SB_USER", "")
	t.Setenv("SB_USERS", "alice:plaintext, bob:"+string(hashA))

	users, creds, err := ParseUsers()
	require.NoError(t, err)
	assert.Len(t, users, 2)
	assert.Len(t, creds, 2)
	assert.True(t, users["alice"].IsPlaintext)
	assert.False(t, users["bob"].IsPlaintext)
}

func TestParseUsers_Invalid(t *testing.T) {
	t.Setenv("SB_USER", "nocolon")
	t.Setenv("SB_USERS", "")

	_, _, err := ParseUsers()
	assert.Error(t, err)
}

func TestBuildAuthorizer(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct"), bcrypt.MinCost)
	users := map[string]UserEntry{
		"alice": {Username: "alice", PasswordHash: string(hash)},
	}
	authorize := BuildAuthorizer(users)

	assert.True(t, authorize("alice", "correct"))
	assert.False(t, authorize("alice", "wrong"))
	assert.False(t, authorize("unknown", "correct"))
}

func TestParseUsers_CredStringsAreSorted(t *testing.T) {
	t.Setenv("SB_USER", "")
	t.Setenv("SB_USERS", "zebra:p1, apple:p2, mango:p3")

	_, creds, err := ParseUsers()
	require.NoError(t, err)
	require.Len(t, creds, 3)
	assert.Less(t, creds[0], creds[1])
	assert.Less(t, creds[1], creds[2])
}
