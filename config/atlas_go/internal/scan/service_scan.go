package scan

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
	"atlas/internal/db"
)

func ServiceScan(ip, mac string) error {
	dbConn, err := sql.Open("sqlite3", db.DBPath())
	if err != nil {
		return fmt.Errorf("open db: %v", err)
	}
	defer dbConn.Close()

	services := discoverServices(ip)
	upsertServices(dbConn, mac, services)
	fmt.Printf("Found %d services on %s (%s)\n", len(services), ip, mac)
	return nil
}
