package db

import (
	"os"
	"path/filepath"
)

// DataDir returns the base data directory.
// Defaults to /config (container), overridden by ATLAS_DATA_DIR env var.
func DataDir() string {
	if d := os.Getenv("ATLAS_DATA_DIR"); d != "" {
		return d
	}
	return "/config"
}

func DBPath() string  { return filepath.Join(DataDir(), "db", "atlas.db") }
func LogsDir() string { return filepath.Join(DataDir(), "logs") }
