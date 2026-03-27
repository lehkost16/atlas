package scan

import (
	"bufio"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
	"unicode/utf8"

	_ "github.com/mattn/go-sqlite3"
	"atlas/internal/db"
	"atlas/internal/utils"
)

type HostInfo struct {
	IP            string
	Name          string
	InterfaceName string
}

// sanitizeName removes non-UTF-8 bytes and control characters from hostnames
func sanitizeName(s string) string {
	if utf8.ValidString(s) {
		return s
	}
	// Replace invalid bytes
	var b strings.Builder
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		if r == utf8.RuneError && size == 1 {
			b.WriteRune('?')
		} else {
			b.WriteRune(r)
		}
		i += size
	}
	return b.String()
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
	// Run both ICMP and ARP scans, merge results for maximum coverage
	results := make(map[string]string)

	for _, args := range [][]string{
		{"-sn", "-T4", "--min-parallelism", "100", subnet},
		{"-sn", "-PR", "-T4", "--min-parallelism", "100", subnet},
	} {
		out, err := exec.Command("nmap", args...).Output()
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(out), "\n") {
			if strings.HasPrefix(line, "Nmap scan report for") {
				fields := strings.Fields(line)
				if len(fields) == 6 && strings.HasPrefix(fields[5], "(") {
					name := fields[4]
					ip := strings.Trim(fields[5], "()")
					if _, exists := results[ip]; !exists {
						results[ip] = name
					}
				} else if len(fields) == 5 {
					ip := fields[4]
					if _, exists := results[ip]; !exists {
						results[ip] = "NoName"
					}
				}
			}
		}
	}
	return results, nil
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

// upsertDeviceWithTag writes a device; only sets tag if device has no existing tag
func upsertDeviceWithTag(db *sql.DB, ip, name, mac, gatewayIP, interfaceName, defaultTag string) error {
	now := time.Now().Format("2006-01-02 15:04:05")

	if mac != "" && mac != "Unknown" {
		_, err := db.Exec(`
			INSERT INTO devices (mac, hostname, current_ip, tags, interface_name, next_hop, network_name, last_seen, online_status)
			VALUES (?, ?, ?, ?, ?, ?, 'LAN', ?, 'online')
			ON CONFLICT(mac) DO UPDATE SET
				hostname=excluded.hostname,
				current_ip=excluded.current_ip,
				interface_name=excluded.interface_name,
				next_hop=excluded.next_hop,
				last_seen=excluded.last_seen,
				online_status='online',
				tags=CASE WHEN tags='' OR tags IS NULL THEN excluded.tags ELSE tags END
		`, mac, name, ip, defaultTag, interfaceName, gatewayIP, now)
		if err != nil {
			return fmt.Errorf("upsert device %s: %v", mac, err)
		}
	}

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

// upsertDevice is kept for backward compat
func upsertDevice(db *sql.DB, ip, name, mac, gatewayIP, interfaceName string) error {
	return upsertDeviceWithTag(db, ip, name, mac, gatewayIP, interfaceName, "")
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
		// Use IP as fallback name; tag as "其他" for unnamed hosts
		tag := ""
		if name == "" || name == "NoName" {
			name = ip
			tag = "其他"
		}
		mac := getMacFromArp(ip)
		if err := upsertDeviceWithTag(dbConn, ip, sanitizeName(name), mac, gatewayIP, interfaceName, tag); err != nil {
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

	// Use SCAN_SUBNETS env var if set, otherwise auto-detect interfaces
	subnets, err := utils.GetSubnetsToScan()
	if err != nil {
		return fmt.Errorf("failed to detect subnets: %v", err)
	}

	// Build interface map for subnet → interface name
	ifaceMap := map[string]string{}
	if ifaces, e := utils.GetAllInterfaces(); e == nil {
		for _, iface := range ifaces {
			ifaceMap[iface.Subnet] = iface.Name
		}
	}

	gatewayIP, err := getDefaultGateway()
	if err != nil {
		logf("⚠️ Could not determine gateway: %v", err)
		gatewayIP = ""
	}

	totalHosts := 0
	for _, subnet := range subnets {
		ifaceName := ifaceMap[subnet]
		if ifaceName == "" {
			ifaceName = "unknown"
		}
		logf("Discovering live hosts on %s (interface: %s)...", subnet, ifaceName)
		hosts, err := runNmap(subnet)
		if err != nil {
			logf("⚠️ Failed to scan subnet %s: %v", subnet, err)
			continue
		}
		logf("Discovered %d hosts on %s", len(hosts), subnet)
		totalHosts += len(hosts)

		if err := updateSQLiteDB(hosts, gatewayIP, ifaceName); err != nil {
			logf("⚠️ Failed to update database for subnet %s: %v", subnet, err)
			continue
		}
	}

	updateExternalIPInDB()
	logf("Total hosts updated: %d", totalHosts)
	return nil
}
