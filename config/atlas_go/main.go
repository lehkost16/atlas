package main

import (
    "fmt"
    "log"
    "os"

    "atlas/internal/scan"
    "atlas/internal/db"
)

func main() {
    if len(os.Args) < 2 {
        log.Fatalf("Usage: ./atlas <command>\nAvailable commands: fastscan, dockerscan")
    }

    switch os.Args[1] {
    case "fastscan":
        fmt.Println("🚀 Running fast scan...")
        err := scan.FastScan()
        if err != nil {
            log.Fatalf("❌ Fast scan failed: %v", err)
        }
        fmt.Println("✅ Fast scan complete.")
    case "dockerscan":
        fmt.Println("🐳 Running Docker scan...")
        err := scan.DockerScan()
        if err != nil {
            log.Fatalf("❌ Docker scan failed: %v", err)
        }
        fmt.Println("✅ Docker scan complete.")
    case "deepscan":
        fmt.Println("🚀 Running deep scan...")
        err := scan.DeepScan()
        if err != nil {
            log.Fatalf("❌ Deep scan failed: %v", err)
        }
        fmt.Println("✅ Deep scan complete.")
    case "servicescan":
        if len(os.Args) < 4 {
            log.Fatalf("Usage: ./atlas servicescan <ip> <mac>")
        }
        ip := os.Args[2]
        mac := os.Args[3]
        fmt.Printf("🔍 Scanning services on %s (%s)...\n", ip, mac)
        err := scan.ServiceScan(ip, mac)
        if err != nil {
            log.Fatalf("❌ Service scan failed: %v", err)
        }
        fmt.Println("✅ Service scan complete.")
    case "initdb":
        fmt.Println("📦 Initializing database...")
        err := db.InitDB()
        if err != nil {
            log.Fatalf("❌ DB init failed: %v", err)
        }
        fmt.Println("✅ Database initialized.")
    default:
        log.Fatalf("Unknown command: %s", os.Args[1])
    }
}
