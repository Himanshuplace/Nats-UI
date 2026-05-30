package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"
)

const tokenTTL = 24 * time.Hour

// AppConfig is the top-level config file structure.
type AppConfig struct {
	Auth            AuthConfig `json:"auth"`
	ConnectionsFile string     `json:"connections_file"`
}

// AuthConfig holds the app-level credentials and JWT signing secret.
type AuthConfig struct {
	Username string `json:"username"`
	Password string `json:"password"`
	Secret   string `json:"secret"`
}

type jwtHeader struct {
	Alg string `json:"alg"`
	Typ string `json:"typ"`
}

type jwtClaims struct {
	Sub string `json:"sub"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

// LoadConfig reads the config file at path, creating a default one if absent.
func LoadConfig(path string) (*AppConfig, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		cfg := defaultConfig()
		if writeErr := writeConfig(path, cfg); writeErr != nil {
			slog.Warn("could not write default config", "path", path, "err", writeErr)
		} else {
			slog.Info("created default config — change the password before exposing to a network",
				"path", path, "username", cfg.Auth.Username, "password", cfg.Auth.Password)
		}
		return cfg, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	var cfg AppConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	if cfg.Auth.Secret == "" {
		cfg.Auth.Secret = randomSecret()
	}
	if cfg.ConnectionsFile == "" {
		cfg.ConnectionsFile = "./natsui-connections.json"
	}
	return &cfg, nil
}

func defaultConfig() *AppConfig {
	return &AppConfig{
		Auth: AuthConfig{
			Username: "admin",
			Password: "changeme",
			Secret:   randomSecret(),
		},
		ConnectionsFile: "./natsui-connections.json",
	}
}

func writeConfig(path string, cfg *AppConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0600)
}

// ValidateCredentials returns true if username and password match the config.
func ValidateCredentials(cfg *AuthConfig, username, password string) bool {
	return cfg.Username == username && cfg.Password == password
}

// GenerateToken creates a signed HS256 JWT for the given subject.
func GenerateToken(subject, secret string) (string, error) {
	header, _ := json.Marshal(jwtHeader{Alg: "HS256", Typ: "JWT"})
	claims, _ := json.Marshal(jwtClaims{
		Sub: subject,
		Iat: time.Now().Unix(),
		Exp: time.Now().Add(tokenTTL).Unix(),
	})

	hEnc := base64.RawURLEncoding.EncodeToString(header)
	cEnc := base64.RawURLEncoding.EncodeToString(claims)
	sigMsg := hEnc + "." + cEnc

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sigMsg))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return sigMsg + "." + sig, nil
}

// ValidateToken verifies a JWT and returns the subject claim.
func ValidateToken(tokenStr, secret string) (string, error) {
	parts := strings.Split(tokenStr, ".")
	if len(parts) != 3 {
		return "", errors.New("invalid token format")
	}

	sigMsg := parts[0] + "." + parts[1]
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(sigMsg))
	expected := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	if !hmac.Equal([]byte(parts[2]), []byte(expected)) {
		return "", errors.New("invalid token signature")
	}

	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", errors.New("malformed token claims")
	}

	var claims jwtClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return "", errors.New("malformed token claims")
	}

	if time.Now().Unix() > claims.Exp {
		return "", errors.New("token expired")
	}
	return claims.Sub, nil
}

func randomSecret() string {
	b := make([]byte, 32)
	rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
