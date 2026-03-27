package scan

import (
	"bufio"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"sync"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"atlas/internal/db"
	"atlas/internal/utils"
)

// ServiceInfo represents a discovered service on a host
type ServiceInfo struct {
	Port   int
	Proto  string
	Type   string
	Title  string
	Banner string
	Status string
}

// Default ports to probe for service discovery
var defaultServicePorts = []int{21, 22, 23, 25, 53, 80, 443, 3000, 3306, 5173, 5432, 6379, 8080, 8443, 8888, 9090}

// getServicePorts returns the port list to scan.
// Priority: DB settings table → SCAN_SERVICE_PORTS env var → hardcoded defaults.
func getServicePorts() []int {
	// 1. Try DB settings
	if ports := loadPortsFromDB(); len(ports) > 0 {
		return ports
	}
	// 2. Try env var: comma-separated, e.g. "22,80,443,8080"
	if env := os.Getenv("SCAN_SERVICE_PORTS"); env != "" {
		if ports := parsePortList(env); len(ports) > 0 {
			return ports
		}
	}
	return defaultServicePorts
}

func loadPortsFromDB() []int {
	dbConn, err := sql.Open("sqlite3", db.DBPath())
	if err != nil {
		return nil
	}
	defer dbConn.Close()
	var val string
	err = dbConn.QueryRow(`SELECT value FROM settings WHERE key='service_ports'`).Scan(&val)
	if err != nil {
		return nil
	}
	return parsePortList(val)
}

func parsePortList(s string) []int {
	var ports []int
	for _, part := range strings.Split(s, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		var p int
		if _, err := fmt.Sscanf(part, "%d", &p); err == nil && p > 0 && p <= 65535 {
			ports = append(ports, p)
		}
	}
	return ports
}

func getNetBIOSName(ip string) string {
	out, err := exec.Command("nbtscan", ip).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == ip {
			return fields[1]
		}
	}
	return ""
}

func bestHostName(ip string, nmapName string) string {
	if nmapName != "" && nmapName != "NoName" {
		return nmapName
	}
	names, err := net.LookupAddr(ip)
	if err == nil && len(names) > 0 {
		name := strings.TrimSuffix(names[0], ".")
		if name != "" {
			return name
		}
	}
	name := getNetBIOSName(ip)
	if name != "" {
		return name
	}
	return "NoName"
}

func discoverLiveHosts(subnet string) ([]HostInfo, error) {
	seen := make(map[string]string) // ip -> name

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
					ip := strings.Trim(fields[5], "()")
					if _, exists := seen[ip]; !exists {
						seen[ip] = fields[4]
					}
				} else if len(fields) == 5 {
					ip := fields[4]
					if _, exists := seen[ip]; !exists {
						seen[ip] = "NoName"
					}
				}
			}
		}
	}

	var hosts []HostInfo
	for ip, name := range seen {
		hosts = append(hosts, HostInfo{IP: ip, Name: name})
	}
	return hosts, nil
}

func parseNmapPorts(s string) string {
	parts := strings.Split(s, ",")
	var readable []string
	for _, p := range parts {
		fields := strings.Split(p, "/")
		if len(fields) < 5 {
			continue
		}
		state, proto, service, port := fields[1], fields[2], fields[4], fields[0]
		if state == "open" || state == "filtered" {
			if service != "" {
				readable = append(readable, fmt.Sprintf("%s/%s (%s)", port, proto, service))
			} else {
				readable = append(readable, fmt.Sprintf("%s/%s", port, proto))
			}
		}
	}
	if len(readable) == 0 {
		return "Unknown"
	}
	return strings.Join(readable, ", ")
}

func scanAllTcp(ip string, logProgress *os.File) (string, string) {
	scanPorts := getServicePorts()
	portList := make([]string, len(scanPorts))
	for i, p := range scanPorts {
		portList[i] = fmt.Sprintf("%d", p)
	}
	portArg := strings.Join(portList, ",")

	logFile := fmt.Sprintf("%s/nmap_tcp_%s.log", db.LogsDir(), strings.ReplaceAll(ip, ".", "_"))
	cmd := exec.Command("nmap", "-O", "-p", portArg, "-T4", ip, "-oG", logFile)
	start := time.Now()
	cmd.Run()
	fmt.Fprintf(logProgress, "TCP scan for %s finished in %s\n", ip, time.Since(start))

	file, err := os.Open(logFile)
	if err != nil {
		return "Unknown", "Unknown"
	}
	defer file.Close()

	var openPorts, osInfo string
	rePorts := regexp.MustCompile(`Ports: ([^\n]*?)Ignored State:`)
	reOS := regexp.MustCompile(`OS: (.*)`)

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		if m := rePorts.FindStringSubmatch(line); m != nil {
			openPorts = parseNmapPorts(m[1])
		}
		if m := reOS.FindStringSubmatch(line); m != nil {
			rawOs := m[1]
			osInfo = strings.SplitN(rawOs, "\t", 2)[0]
			if idx := strings.Index(osInfo, "Seq Index:"); idx != -1 {
				osInfo = strings.TrimSpace(osInfo[:idx])
			}
			osInfo = strings.TrimSpace(osInfo)
		}
	}
	if openPorts == "" {
		openPorts = "Unknown"
	}
	return openPorts, osInfo
}

// fetchHTTPTitle fetches the <title> of an HTTP service
func fetchHTTPTitle(ip string, port int, tls bool) string {
	scheme := "http"
	if tls {
		scheme = "https"
	}
	url := fmt.Sprintf("%s://%s:%d", scheme, ip, port)
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	buf := make([]byte, 4096)
	n, _ := resp.Body.Read(buf)
	body := string(buf[:n])

	re := regexp.MustCompile(`(?i)<title[^>]*>([^<]+)</title>`)
	if m := re.FindStringSubmatch(body); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}

// grabBanner attempts a TCP banner grab on a port
func grabBanner(ip string, port int) string {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), 2*time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	buf := make([]byte, 256)
	n, _ := conn.Read(buf)
	return strings.TrimSpace(string(buf[:n]))
}

// discoverServices probes configured ports and returns service info
func discoverServices(ip string) []ServiceInfo {
	ports := getServicePorts()
	var services []ServiceInfo
	var mu sync.Mutex
	var wg sync.WaitGroup

	for _, port := range ports {
		wg.Add(1)
		go func(p int) {
			defer wg.Done()
			conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, p), 2*time.Second)
			if err != nil {
				return
			}
			conn.Close()

			svc := ServiceInfo{
				Port:   p,
				Proto:  "tcp",
				Status: "open",
			}

			// Classify service type and gather info
			// For known non-HTTP ports, use specific probes
			// For everything else, try HTTP first
			switch p {
			case 22:
				svc.Type = "ssh"
				svc.Banner = grabBanner(ip, p)
			case 21:
				svc.Type = "ftp"
				svc.Banner = grabBanner(ip, p)
			case 25:
				svc.Type = "smtp"
				svc.Banner = grabBanner(ip, p)
			case 53:
				svc.Type = "dns"
			case 3306:
				svc.Type = "mysql"
				svc.Banner = grabBanner(ip, p)
			case 5432:
				svc.Type = "postgresql"
			case 6379:
				svc.Type = "redis"
				svc.Banner = grabBanner(ip, p)
			default:
				// Try HTTP first, then HTTPS, then banner grab
				if title := fetchHTTPTitle(ip, p, false); title != "" {
					svc.Type = "http"
					svc.Title = title
				} else if title := fetchHTTPTitle(ip, p, true); title != "" {
					svc.Type = "https"
					svc.Title = title
				} else {
					// Check if it responds to HTTP at all (even without a title)
					scheme := "http"
					url := fmt.Sprintf("%s://%s:%d", scheme, ip, p)
					client := &http.Client{Timeout: 3 * time.Second}
					if resp, err := client.Get(url); err == nil {
						resp.Body.Close()
						if resp.StatusCode > 0 {
							svc.Type = "http"
						}
					} else {
						// Try HTTPS
						url = fmt.Sprintf("https://%s:%d", ip, p)
						if resp, err := client.Get(url); err == nil {
							resp.Body.Close()
							svc.Type = "https"
						} else {
							svc.Type = "unknown"
							svc.Banner = grabBanner(ip, p)
						}
					}
				}
			}

			mu.Lock()
			services = append(services, svc)
			mu.Unlock()
		}(port)
	}
	wg.Wait()
	return services
}

// upsertServices writes discovered services to the services table.
// Only services with source='scan' are touched; manually added ones are preserved.
func upsertServices(db *sql.DB, mac string, services []ServiceInfo) {
	now := time.Now().Format("2006-01-02 15:04:05")
	// Only mark scan-sourced services as closed before updating
	_, _ = db.Exec(`UPDATE services SET status='closed' WHERE device_mac=? AND source='scan'`, mac)

	for _, svc := range services {
		_, err := db.Exec(`
			INSERT INTO services (device_mac, port, proto, type, title, banner, status, source, last_seen)
			VALUES (?, ?, ?, ?, ?, ?, 'open', 'scan', ?)
			ON CONFLICT(device_mac, port, proto) DO UPDATE SET
				type=excluded.type,
				title=excluded.title,
				banner=excluded.banner,
				status='open',
				source='scan',
				last_seen=excluded.last_seen
		`, mac, svc.Port, svc.Proto, svc.Type, svc.Title, svc.Banner, now)
		if err != nil {
			fmt.Printf("Failed to upsert service %d for %s: %v\n", svc.Port, mac, err)
		}
	}
}

func DeepScan() error {
	// Use SCAN_SUBNETS env var if set, otherwise auto-detect
	subnets, err := utils.GetSubnetsToScan()
	if err != nil {
		fmt.Printf("⚠️ Could not detect subnets: %v, using fallback\n", err)
		subnets = []string{"192.168.2.0/24"}
	}

	// Build interface map
	ifaceMap := map[string]string{}
	if ifaces, e := utils.GetAllInterfaces(); e == nil {
		for _, iface := range ifaces {
			ifaceMap[iface.Subnet] = iface.Name
		}
	}

	startTime := time.Now()
	logFile := fmt.Sprintf("%s/deep_scan_progress.log", db.LogsDir())
	os.MkdirAll(db.LogsDir(), 0755)
	lf, _ := os.Create(logFile)
	defer lf.Close()

	var hostInfos []HostInfo
	for _, subnet := range subnets {
		ifaceName := ifaceMap[subnet]
		if ifaceName == "" {
			ifaceName = "unknown"
		}
		fmt.Fprintf(lf, "Discovering live hosts on %s (interface: %s)...\n", subnet, ifaceName)
		hosts, err := discoverLiveHosts(subnet)
		if err != nil {
			fmt.Fprintf(lf, "Failed to discover hosts on %s: %v\n", subnet, err)
			continue
		}
		fmt.Fprintf(lf, "Discovered %d hosts on %s\n", len(hosts), subnet)
		for _, host := range hosts {
			host.InterfaceName = ifaceName
			hostInfos = append(hostInfos, host)
		}
	}

	total := len(hostInfos)
	fmt.Fprintf(lf, "Total discovered: %d hosts in %s\n", total, time.Since(startTime))

	dbConn, err := sql.Open("sqlite3", db.DBPath())
	if err != nil {
		return err
	}
	defer dbConn.Close()

	// Don't mark all offline upfront — mark only hosts not found in this scan after completion
	discoveredIPs := make(map[string]bool)
	for _, h := range hostInfos {
		discoveredIPs[h.IP] = true
	}

	var wg sync.WaitGroup
	for idx, host := range hostInfos {
		wg.Add(1)
		go func(idx int, host HostInfo) {
			defer wg.Done()
			ip := host.IP
			name := sanitizeName(bestHostName(ip, host.Name))

			// Use IP as fallback name; tag as "其他" for unnamed hosts
			tag := ""
			if name == "" || name == "NoName" {
				name = ip
				tag = "其他"
			}
			fmt.Fprintf(lf, "Scanning host %d/%d: %s\n", idx+1, total, ip)

			tcpPorts, osInfo := scanAllTcp(ip, lf)
			mac := getMacFromArp(ip)
			status := utils.PingHost(ip)

			openPorts := tcpPorts
			if openPorts == "" {
				openPorts = "Unknown"
			}

			now := time.Now().Format("2006-01-02 15:04:05")

			_, _ = dbConn.Exec(`
				INSERT INTO hosts (ip, name, os_details, mac_address, open_ports, next_hop, network_name, interface_name, last_seen, online_status)
				VALUES (?, ?, ?, ?, ?, '', 'LAN', ?, ?, ?)
				ON CONFLICT(ip, interface_name) DO UPDATE SET
					name=excluded.name,
					os_details=excluded.os_details,
					mac_address=excluded.mac_address,
					open_ports=excluded.open_ports,
					last_seen=CURRENT_TIMESTAMP,
					online_status=excluded.online_status
			`, ip, name, osInfo, mac, openPorts, host.InterfaceName, now, status)

			if mac != "" && mac != "Unknown" {
				_, _ = dbConn.Exec(`
					INSERT INTO devices (mac, hostname, current_ip, tags, os_details, interface_name, network_name, last_seen, online_status)
					VALUES (?, ?, ?, ?, ?, ?, 'LAN', ?, ?)
					ON CONFLICT(mac) DO UPDATE SET
						hostname=excluded.hostname,
						current_ip=excluded.current_ip,
						os_details=excluded.os_details,
						interface_name=excluded.interface_name,
						last_seen=excluded.last_seen,
						online_status=excluded.online_status,
						tags=CASE WHEN tags='' OR tags IS NULL THEN excluded.tags ELSE tags END
				`, mac, name, ip, tag, osInfo, host.InterfaceName, now, status)

				fmt.Fprintf(lf, "Probing services on %s (%s)...\n", ip, mac)
				services := discoverServices(ip)
				upsertServices(dbConn, mac, services)
				fmt.Fprintf(lf, "Found %d services on %s\n", len(services), ip)
			}

			elapsed := time.Since(startTime)
			hostsLeft := total - (idx + 1)
			estLeft := time.Duration(0)
			if idx+1 > 0 {
				estLeft = (elapsed / time.Duration(idx+1)) * time.Duration(hostsLeft)
			}
			fmt.Fprintf(lf, "Progress: %d/%d hosts, elapsed: %s, estimated left: %s\n", idx+1, total, elapsed, estLeft)
		}(idx, host)
	}
	wg.Wait()

	// After scan completes, mark hosts not found in this scan as offline
	rows, _ := dbConn.Query("SELECT current_ip FROM devices")
	if rows != nil {
		for rows.Next() {
			var ip string
			rows.Scan(&ip)
			if ip != "" && !discoveredIPs[ip] {
				dbConn.Exec("UPDATE devices SET online_status='offline' WHERE current_ip=?", ip)
				dbConn.Exec("UPDATE hosts SET online_status='offline' WHERE ip=?", ip)
			}
		}
		rows.Close()
	}

	fmt.Fprintf(lf, "Deep scan complete in %s\n", time.Since(startTime))
	return nil
}
