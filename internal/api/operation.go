package api

import (
	"net/http"
	"path"
	"strings"

	"github.com/unraid-mobile/unraid-mobile/internal/app/operation"
)

// handleOperationQuery validates one ID segment before querying the in-memory Store.
// It runs before ServeMux path normalization so malformed paths are not redirected.
func handleOperationQuery(w http.ResponseWriter, r *http.Request, store *operation.Store) {
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/operations/")
	if r.Method != http.MethodGet || !strings.HasPrefix(r.URL.Path, "/api/v1/operations/") ||
		id == "" || id == "." || id == ".." || strings.Contains(id, "/") ||
		r.URL.Path != path.Clean(r.URL.Path) || strings.Contains(strings.ToLower(r.URL.EscapedPath()), "%2f") {
		writeError(w, http.StatusNotFound, "ROUTE_NOT_FOUND", "Route not found", false)
		return
	}
	if store == nil {
		writeError(w, http.StatusServiceUnavailable, "OPERATIONS_UNAVAILABLE", "Operations are unavailable", true)
		return
	}
	op, exists := store.Get(id)
	if !exists {
		writeError(w, http.StatusNotFound, "OPERATION_NOT_FOUND", "Operation not found", false)
		return
	}
	writeJSON(w, http.StatusOK, op)
}

// isOperationPath identifies the query namespace, including malformed descendants.
func isOperationPath(requestPath string) bool {
	cleaned := path.Clean(requestPath)
	return requestPath == "/api/v1/operations" || strings.HasPrefix(requestPath, "/api/v1/operations/") ||
		cleaned == "/api/v1/operations" || strings.HasPrefix(cleaned, "/api/v1/operations/")
}
