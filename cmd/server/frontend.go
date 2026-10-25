package main

import (
	"errors"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// newFrontendHandler dispatches API requests before validating static and SPA paths.
func newFrontendHandler(apiHandler http.Handler, staticFiles fs.FS) http.Handler {
	frontend := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !validFrontendPath(r) {
			frontendError(w, r, http.StatusNotFound)
			return
		}
		if r.URL.Path == "/healthz" {
			apiHandler.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			frontendError(w, r, http.StatusMethodNotAllowed)
			return
		}

		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		info, err := fs.Stat(staticFiles, name)
		if errors.Is(err, fs.ErrNotExist) && isClientRoute(r.URL.Path) {
			name = "index.html"
			info, err = fs.Stat(staticFiles, name)
		}
		if err != nil || !info.Mode().IsRegular() {
			frontendError(w, r, http.StatusNotFound)
			return
		}

		// Serve the selected regular file without index.html URL redirects.
		request := r.Clone(r.Context())
		request.URL.Path = "/"
		request.URL.RawPath = ""
		http.ServeFileFS(w, request, staticFiles, name)
	})
	return routeAPIRequests(apiHandler, frontend)
}

// validFrontendPath rejects noncanonical, encoded and hidden paths without cleaning.
func validFrontendPath(r *http.Request) bool {
	requestPath := r.URL.Path
	if !strings.HasPrefix(requestPath, "/") || r.URL.RawPath != "" ||
		r.URL.EscapedPath() != requestPath || strings.Contains(requestPath, "\\") {
		return false
	}
	if requestPath == "/" {
		return true
	}
	name := strings.TrimPrefix(requestPath, "/")
	if !fs.ValidPath(name) || requestPath != path.Clean(requestPath) {
		return false
	}
	for _, segment := range strings.Split(name, "/") {
		if strings.HasPrefix(segment, ".") {
			return false
		}
	}
	return true
}

// isClientRoute excludes the asset namespace and extensions from SPA fallback.
func isClientRoute(requestPath string) bool {
	if requestPath == "/assets" || strings.HasPrefix(requestPath, "/assets/") {
		return false
	}
	for _, segment := range strings.Split(requestPath, "/") {
		if path.Ext(segment) != "" {
			return false
		}
	}
	return true
}

// frontendError returns plain errors and suppresses response bodies for HEAD.
func frontendError(w http.ResponseWriter, r *http.Request, status int) {
	if r.Method == http.MethodHead {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.WriteHeader(status)
		return
	}
	http.Error(w, http.StatusText(status), status)
}
