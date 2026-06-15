package server

import (
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/render"
)

// buildFsRoutes creates the filesystem API routes
func buildFsRoutes() http.Handler {
	fsRouter := chi.NewRouter()

	// File list endpoint
	fsRouter.Get("/", handleFsList)

	// File operations
	fsRouter.Get("/*", handleFsGet)
	fsRouter.Put("/*", handleFsPut)
	fsRouter.Delete("/*", handleFsDelete)
	fsRouter.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Allow", "GET, PUT, DELETE, OPTIONS")
		w.WriteHeader(http.StatusOK)
	})

	return fsRouter
}

func handleFsList(w http.ResponseWriter, r *http.Request) {
	spaceConfig := spaceConfigFromContext(r.Context())
	username := usernameFromContext(r.Context())
	if r.Header.Get("X-Sync-Mode") != "" {
		// Handle direct requests for JSON representation of file list
		files, err := spaceConfig.SpacePrimitives.FetchFileList()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		// Filter: always hide _permissions.json and _users.json; hide files in
		// PermNone folders.
		filtered := make([]FileMeta, 0, len(files))
		for _, f := range files {
			if f.Name == permissionsFileName || f.Name == usersFileName {
				continue
			}
			if spaceConfig.Permissions.GetFolderPermission(f.Name, username) == PermNone {
				continue
			}
			filtered = append(filtered, f)
		}
		w.Header().Set("X-Space-Path", spaceConfig.SpaceFolderPath)
		w.Header().Set("Cache-Control", "no-cache")
		render.JSON(w, r, filtered)
	} else {
		// Otherwise, redirect to the UI
		http.Redirect(w, r, "/", http.StatusTemporaryRedirect)
	}
}

// handleFsGet handles GET requests for individual files
func handleFsGet(w http.ResponseWriter, r *http.Request) {
	path := DecodeURLParam(r, "*")
	spaceConfig := spaceConfigFromContext(r.Context())
	username := usernameFromContext(r.Context())

	// Block direct access to the permissions and users files.
	if path == permissionsFileName || path == usersFileName {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Check folder-level read permission.
	if spaceConfig.Permissions.GetFolderPermission(path, username) == PermNone {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// log.Printf("Got this path: %s", path)

	if r.Header.Get("X-Get-Meta") != "" {
		// Getting meta via GET request
		meta, err := spaceConfig.SpacePrimitives.GetFileMeta(path)
		if err != nil {
			if err == ErrNotFound {
				http.NotFound(w, r)
			} else {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}

		setFileMetaHeaders(w, meta)
		w.WriteHeader(http.StatusOK)
		return
	}

	// Read file content
	data, meta, err := spaceConfig.SpacePrimitives.ReadFile(path)
	if err != nil {
		if err == ErrNotFound {
			http.NotFound(w, r)
		} else {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	setFileMetaHeaders(w, meta)
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

// handleFsPut handles PUT requests for writing files
func handleFsPut(w http.ResponseWriter, r *http.Request) {
	path := DecodeURLParam(r, "*")
	spaceConfig := spaceConfigFromContext(r.Context())
	username := usernameFromContext(r.Context())

	// Block direct access to the permissions and users files.
	if path == permissionsFileName || path == usersFileName {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Require write permission (read-only folders are not writable).
	if spaceConfig.Permissions.GetFolderPermission(path, username) != PermWrite {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Read request body
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, "Failed to read request body", http.StatusBadRequest)
		return
	}

	// Write file
	meta, err := spaceConfig.SpacePrimitives.WriteFile(path, body, getFileMetaFromHeaders(r.Header, path))
	if err != nil {
		log.Printf("Write failed: %v\n", err)
		http.Error(w, "Write failed", http.StatusInternalServerError)
		return
	}

	setFileMetaHeaders(w, meta)
	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// handleFsDelete handles DELETE requests for removing files
func handleFsDelete(w http.ResponseWriter, r *http.Request) {
	path := DecodeURLParam(r, "*")
	spaceConfig := spaceConfigFromContext(r.Context())
	username := usernameFromContext(r.Context())

	// Block direct access to the permissions and users files.
	if path == permissionsFileName || path == usersFileName {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	// Require write permission.
	if spaceConfig.Permissions.GetFolderPermission(path, username) != PermWrite {
		http.Error(w, "Forbidden", http.StatusForbidden)
		return
	}

	if err := spaceConfig.SpacePrimitives.DeleteFile(path); err != nil {
		if err == ErrNotFound {
			http.NotFound(w, r)
		} else {
			log.Printf("Error deleting file: %v\n", err)
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
		return
	}

	w.WriteHeader(http.StatusOK)
	w.Write([]byte("OK"))
}

// setFileMetaHeaders sets HTTP headers based on FileMeta
func setFileMetaHeaders(w http.ResponseWriter, meta FileMeta) {
	w.Header().Set("Content-Type", meta.ContentType)
	w.Header().Set("X-Content-Type", meta.ContentType)
	w.Header().Set("X-Created", strconv.FormatInt(meta.Created, 10))
	w.Header().Set("X-Last-Modified", strconv.FormatInt(meta.LastModified, 10))
	w.Header().Set("X-Content-Length", strconv.FormatInt(meta.Size, 10))
	w.Header().Set("X-Permission", meta.Perm)
	w.Header().Set("Cache-Control", "no-cache")
}

// Build FileMeta from HTTP headers (reverse of setFileMetaHeaders)
func getFileMetaFromHeaders(h http.Header, path string) *FileMeta {
	var err error

	contentType := h.Get("X-Content-Type")
	if contentType == "" {
		contentType = h.Get("Content-Type")
	}
	fm := &FileMeta{
		Name:        path,
		ContentType: contentType,
		Perm:        h.Get("X-Permission"),
	}
	if fm.Perm == "" {
		fm.Perm = "ro"
	}
	if h.Get("X-Content-Length") != "" {
		fm.Size, err = strconv.ParseInt(h.Get("X-Content-Length"), 10, 64)
		if err != nil {
			log.Printf("Could not parse content length: %v", err)
		}
	} else if h.Get("Content-Length") != "" {
		fm.Size, err = strconv.ParseInt(h.Get("Content-Length"), 10, 64)
		if err != nil {
			log.Printf("Could not parse content length: %v", err)
		}
	}
	if h.Get("X-Created") != "" {
		fm.Created, err = strconv.ParseInt(h.Get("X-Created"), 10, 64)
		if err != nil {
			log.Printf("Could not parse created time: %v", err)
		}
	}
	if h.Get("X-Last-Modified") != "" {
		fm.LastModified, err = strconv.ParseInt(h.Get("X-Last-Modified"), 10, 64)
		if err != nil {
			log.Printf("Could not parse modified time: %v", err)
		}
	}

	return fm
}

func DecodeURLParam(r *http.Request, name string) string {
	// Source: https://github.com/go-chi/chi/issues/642
	value := chi.URLParam(r, name)
	if r.URL.RawPath != "" {
		value, _ = url.PathUnescape(value)
	}
	return value
}
