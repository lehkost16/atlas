package scan

import (
	"bufio"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"atlas/internal/db"
	"atlas/internal/utils"
)

type HostInfo struct {
	IP            string
	Name          string
	InterfaceName string
}

func getDefaultGateway() (string, error) {
	out, err := exec.Command("ip", "route").Output()
	if err != nil {
		return "", err
	}
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "default") {
			fields := strings.Fields(line)
			for i, f := range fields {
				if f == "via" && i+1 < len(fields) {
					return fields[i+1], nil
				}
			}
		}
	}
	return "", fmt.Errorf("no default gateway found")
}

func runNmap(subnet string) (map[string]string, error) {
	out, err := exec.Command("nmap", "-sn", subnet).Output()
	if err != nil {
		return nil, err
	}

	hosts := make(map[string]string)
	for _, line := range strings.Split(string(out), "\n") {
		if strings.HasPrefix(line, "Nmap scan report for") {
			fields := strings.Fields(line)
			if len(fields) == 6 && strings.HasPrefix(fields[5], "(") {
				name := fields[4]
				ip := strings.Trim(fields[5], "()")
				hosts[ip] = name
			} else if len(fields) == 5 {
				ip := fields[4]
				hosts[ip] = "NoName"
			}
		}
	}
	return hosts, nil
}

// getMacFromArp reads MAC address from /proc/net/arp for a given IP
func getMacFromArp(ip string) string {
	file, err := os.Open("/proc/net/arp")
	if err != nil {
		return ""
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Scan() // skip header
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 4 && fields[0] == ip {
			mac := fields[3]
			if mac != "00:00:00:00:00:00" {
				return mac
			}
		}
	}
	return ""
}

// upsertDevice writes a discovered host into the devices table using MAC as primary key.
// Falls back to writing into legacy hosts table if MAC is unavailable.
func upsertDevice(db *sql.DB, ip, name, mac, gatewayIP, interfaceName string) error {
	now := time.Now().Format("2006-01-02 15:04:05")

	if mac != "" && mac != "Unknown" {
		_, err := db.Exec(`
			INSERT INTO devices (mac, hostname, current_ip, interface_name, next_hop, network_name, last_seen, online_status)
			VALUES (?, ?, ?, ?, ?, 'LAN', ?, 'online')
			ON CONFLICT(mac) DO UPDATE SET
				hostname=excluded.hostname,
				current_ip=excluded.current_ip,
				interface_name=excluded.interface_name,
				next_hop=excluded.next_hop,
				last_seen=excluded.last_seen,
				online_status='online'
		`, mac, name, ip, interfaceName, gatewayIP, now)
		if err != nil {
			return fmt.Errorf("upsert device %s: %v", mac, err)
		}
	}

	// Also keep legacy hosts table in sync
	_, err := db.Exec(`
		INSERT INTO hosts (ip, name, os_details, mac_address, open_ports, next_hop, network_name, interface_name, last_seen, online_status)
		VALUES (?, ?, 'Unknown', ?, 'Unknown', ?, 'LAN', ?, ?, 'online')
		ON CONFLICT(ip, interface_name) DO UPDATE SET
			name=excluded.name,
			mac_address=excluded.mac_address,
			last_seen=excluded.last_seen,
			online_status='online',
			next_hop=excluded.next_hop
	`, ip, name, mac, gatewayIP, interfaceName, now)
	return err
}

func updateSQLiteDB(hosts map[string]string, gatewayIP string, interfaceName string) error {
	dbConn, err := sql.Open("sqlite3", db.DBPath())
	if err != nil {
		return err
	}
	defer dbConn.Close()

	_, _ = dbConn.Exec("UPDATE hosts SET online_status = 'offline' WHERE interface_name = ?", interfaceName)
	_, _ = dbConn.Exec("UPDATE devices SET online_status = 'offline' WHERE interface_name = ?", interfaceName)

	for ip, name := range hosts {
		// Skip hosts with no resolvable name (likely personal/unknown devices)
		if name == "" || name == "NoName" {
			continue
		}
		mac := getMacFromArp(ip)
		if err := upsertDevice(dbConn, ip, name, mac, gatewayIP, interfaceName); err != nil {
			fmt.Printf("Insert/update failed for %s: %v\n", ip, err)
		}
	}

	return nil
}

func updateExternalIPInDB() {
	urls := []string{
		"https://ifconfig.me",
		"https://api.ipify.org",
	}

	var ip string
	for _, url := range urls {
		out, err := exec.Command("curl", "-s", url).Output()
		if err == nil && len(out) > 0 {
			ip = strings.TrimSpace(string(out))
			break
		}
	}

	if ip == "" {
		fmt.Println("⚠️ Could not determine external IP")
		return
	}

	dbConn, err := sql.Open("sqlite3", db.DBPath())
	if err != nil {
		fmt.Println("❌ Failed to open DB:", err)
		return
	}
	defer dbConn.Close()

	_, _ = dbConn.Exec(`INSERT OR IGNORE INTO external_networks (public_ip) VALUES (?)`, ip)
	_, _ = dbConn.Exec(`UPDATE external_networks SET last_seen = CURRENT_TIMESTAMP WHERE public_ip = ?`, ip)
	fmt.Println("🌐 External IP recorded:", ip)
}

func FastScan() error {
	logFile := fmt.Sprintf("%s/fast_scan_progress.log", db.LogsDir())
	if err := os.MkdirAll(db.LogsDir(), 0755); err != nil {
		return fastScanCore(nil)
	}
	lf, _ := os.Create(logFile)
	if lf == nil {
		return fastScanCore(nil)
	}
	defer lf.Close()
	start := time.Now()
	fmt.Fprintf(lf, "🚀 Fast scan started at %s\n", start.Format(time.RFC3339))
	err := fastScanCore(lf)
	fmt.Fprintf(lf, "Fast scan complete in %s\n", time.Since(start))
	return err
}

func fastScanCore(lf *os.File) error {
	logf := func(format string, args ...any) {
		msg := fmt.Sprintf(format, args...)
		fmt.Println(msg)
		if lf != nil {
			fmt.Fprintln(lf, msg)
		}
	}

	interfaces, err := utils.GetAllInterfaces()
	if err != nil {
		return fmt.Errorf("failed to detect network interfaces: %v", err)
	}

	gatewayIP, err := getDefaultGateway()
	if err != nil {
		logf("⚠️ Could not determine gateway: %v", err)
		gatewayIP = ""
	}

	totalHosts := 0
	for _, iface := range interfaces {
		logf("Discovering live hosts on %s (interface: %s)...", iface.Subnet, iface.Name)
		hosts, err := runNmap(iface.Subnet)
		if err != nil {
			logf("⚠️ Failed to scan subnet %s on interface %s: %v", iface.Subnet, iface.Name, err)
			continue
		}
		logf("Discovered %d hosts on %s", len(hosts), iface.Subnet)
		totalHosts += len(hosts)

		if err := updateSQLiteDB(hosts, gatewayIP, iface.Name); err != nil {
			logf("⚠️ Failed to update database for interface %s: %v", iface.Name, err)
			continue
		}
	}

	updateExternalIPInDB()
	logf("Total hosts updated: %d", totalHosts)
	return nil
}
