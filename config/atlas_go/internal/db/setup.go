package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

func InitDB() error {
	dbDir := filepath.Dir(DBPath())
	if err := os.MkdirAll(dbDir, 0755); err != nil {
		return fmt.Errorf("failed to create DB dir: %v", err)
	}

	db, err := sql.Open("sqlite3", DBPath())
	if err != nil {
		return fmt.Errorf("failed to open DB: %v", err)
	}
	defer db.Close()

	schema := `
-- Primary device table: MAC is the unique identity
CREATE TABLE IF NOT EXISTS devices (
    mac         TEXT PRIMARY KEY,
    hostname    TEXT,
    alias       TEXT DEFAULT '',
    current_ip  TEXT,
    tags        TEXT DEFAULT '',
    os_details  TEXT DEFAULT 'Unknown',
    interface_name TEXT DEFAULT 'unknown',
    next_hop    TEXT DEFAULT '',
    network_name TEXT DEFAULT 'LAN',
    last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
    online_status TEXT DEFAULT 'online',
    ignored     INTEGER DEFAULT 0
);

-- Services discovered on each device
CREATE TABLE IF NOT EXISTS services (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    device_mac  TEXT NOT NULL REFERENCES devices(mac) ON DELETE CASCADE,
    port        INTEGER NOT NULL,
    proto       TEXT DEFAULT 'tcp',
    type        TEXT DEFAULT 'unknown',
    title       TEXT DEFAULT '',
    banner      TEXT DEFAULT '',
    status      TEXT DEFAULT 'open',
    source      TEXT DEFAULT 'scan',
    last_seen   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_mac, port, proto)
);

-- Docker containers (keyed by container_id + network)
CREATE TABLE IF NOT EXISTS docker_hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT NOT NULL,
    ip TEXT,
    name TEXT,
    os_details TEXT,
    mac_address TEXT,
    open_ports TEXT,
    next_hop TEXT,
    network_name TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    online_status TEXT DEFAULT 'online',
    UNIQUE(container_id, network_name)
);

-- External/public IP tracking
CREATE TABLE IF NOT EXISTS external_networks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_ip TEXT UNIQUE,
    provider TEXT,
    location TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Key-value settings store
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- Audit logs
CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    log_type TEXT NOT NULL,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Legacy hosts table kept for backward compat (read-only after migration)
CREATE TABLE IF NOT EXISTS hosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT,
    name TEXT,
    os_details TEXT,
    mac_address TEXT,
    open_ports TEXT,
    next_hop TEXT,
    network_name TEXT,
    interface_name TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    online_status TEXT DEFAULT 'online'
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hosts_ip_interface ON hosts(ip, interface_name);
CREATE INDEX IF NOT EXISTS idx_services_device_mac ON services(device_mac);
CREATE INDEX IF NOT EXISTS idx_devices_ip ON devices(current_ip);
`

	if _, err := db.Exec(schema); err != nil {
		return fmt.Errorf("schema execution failed: %v", err)
	}

	// Migration: backfill devices table from existing hosts data
	_, _ = db.Exec(`
		INSERT OR IGNORE INTO devices (mac, hostname, current_ip, os_details, interface_name, next_hop, network_name, last_seen, online_status)
		SELECT mac_address, name, ip, os_details, interface_name, next_hop, network_name, last_seen, online_status
		FROM hosts
		WHERE mac_address IS NOT NULL AND mac_address != '' AND mac_address != 'Unknown'
	`)

	// Legacy compat: ensure hosts table has interface_name column
	_, _ = db.Exec(`ALTER TABLE hosts ADD COLUMN interface_name TEXT;`)
	_, _ = db.Exec(`UPDATE hosts SET interface_name = 'unknown' WHERE interface_name IS NULL OR interface_name = '';`)
	_, _ = db.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hosts_ip_interface ON hosts(ip, interface_name);`)
	// Add ignored column if missing (migration for existing DBs)
	_, _ = db.Exec(`ALTER TABLE devices ADD COLUMN ignored INTEGER DEFAULT 0;`)
	_, _ = db.Exec(`ALTER TABLE devices ADD COLUMN alias TEXT DEFAULT '';`)
	_, _ = db.Exec(`ALTER TABLE services ADD COLUMN source TEXT DEFAULT 'scan';`)

	return nil
}
