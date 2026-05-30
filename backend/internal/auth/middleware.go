package auth

import (
	"net/http"
	"strings"
)

// Middleware validates Bearer JWT tokens. Allows OPTIONS through for CORS pre-flight.
// Also accepts token via ?token= query param for WebSocket upgrades.
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Method == http.MethodOptions {
				next.ServeHTTP(w, r)
				return
			}
			token := extractToken(r)
			if token == "" {
				writeUnauthorized(w, "missing token")
				return
			}
			if _, err := ValidateToken(token, secret); err != nil {
				writeUnauthorized(w, err.Error())
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func extractToken(r *http.Request) string {
	if v := r.Header.Get("Authorization"); strings.HasPrefix(v, "Bearer ") {
		return strings.TrimPrefix(v, "Bearer ")
	}
	return r.URL.Query().Get("token")
}

func writeUnauthorized(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"` + msg + `"}`))
}
