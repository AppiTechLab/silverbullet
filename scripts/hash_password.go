//go:build ignore

// hash_password.go generates a bcrypt hash for a given password.
// Run it with:
//
//	go run scripts/hash_password.go <password>
//
// The output can be used directly in SB_USER or SB_USERS:
//
//	SB_USER=alice:$2b$10$...
package main

import (
	"fmt"
	"os"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] == "" {
		fmt.Fprintln(os.Stderr, "Usage: go run scripts/hash_password.go <password>")
		os.Exit(1)
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(os.Args[1]), bcrypt.DefaultCost)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	fmt.Println(string(hash))
}
