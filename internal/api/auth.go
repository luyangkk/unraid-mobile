package api

import (
	"crypto/sha256"
	"crypto/subtle"
	"net/http"
	"path"
	"strings"
)

// IsAPIRequest recognizes original, decoded and cleaned API namespaces.
// Both authentication and production dispatch use it before mux normalization.
func IsAPIRequest(r *http.Request) bool {
	for _, candidate := range []string{r.URL.Path, r.URL.EscapedPath()} {
		for _, requestPath := range []string{candidate, path.Clean(candidate)} {
			if requestPath == "/api" || strings.HasPrefix(requestPath, "/api/") {
				return true
			}
		}
	}
	return false
}

// authenticateAPI rejects API requests before any routing or dependency access.
func authenticateAPI(token string, next http.Handler) http.Handler {
	if token == "" {
		return next
	}
	expected := sha256.Sum256([]byte(token))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if IsAPIRequest(r) {
			credential, valid := bearerCredential(r.Header)
			actual := sha256.Sum256([]byte(credential))
			if subtle.ConstantTimeCompare(actual[:], expected[:]) != 1 || !valid {
				w.Header().Set("Cache-Control", "no-store")
				w.Header().Set("WWW-Authenticate", "Bearer")
				writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "Authentication required", false)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// bearerCredential accepts exactly one RFC 6750 credential without trimming.
func bearerCredential(header http.Header) (string, bool) {
	values := header.Values("Authorization")
	if len(values) != 1 {
		return "", false
	}
	scheme, credential, found := strings.Cut(values[0], " ")
	if !found || !strings.EqualFold(scheme, "Bearer") || credential == "" {
		return "", false
	}
	padding := false
	for i := 0; i < len(credential); i++ {
		c := credential[i]
		if c == '=' {
			if i == 0 {
				return "", false
			}
			padding = true
			continue
		}
		if padding || !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' ||
			c >= '0' && c <= '9' || strings.ContainsRune("-._~+/", rune(c))) {
			return "", false
		}
	}
	return credential, true
}
