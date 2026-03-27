from fastapi import FastAPI, HTTPException, Depends, Request
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
from typing import Optional
import sqlite3
import subprocess
import logging
import os
import re
import secrets
import time
from scripts.scheduler import get_scheduler

app = FastAPI(
    title="Atlas Network API",
    description="Scan automation, infrastructure discovery, and visualization backend for Atlas",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    root_path="/api",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for request/response
class IntervalUpdate(BaseModel):
    interval: int

class DeviceUpdate(BaseModel):
    hostname: Optional[str] = None
    alias: Optional[str] = None
    tags: Optional[str] = None
    ignored: Optional[bool] = None

class DeviceCreate(BaseModel):
    hostname: str
    current_ip: str
    alias: Optional[str] = None
    mac: Optional[str] = None
    tags: Optional[str] = None
    os_details: Optional[str] = None

class ServiceCreate(BaseModel):
    device_mac: str
    port: int
    proto: Optional[str] = "tcp"
    type: Optional[str] = "unknown"
    title: Optional[str] = ""
    banner: Optional[str] = ""

class ServiceUpdate(BaseModel):
    title: Optional[str] = None
    type: Optional[str] = None

class ServicePortsUpdate(BaseModel):
    ports: list[int]


# ---- Authentication (minimal, single-admin token auth) ----
#
# Backward compatible behavior:
# - If ATLAS_ADMIN_PASSWORD is not set, auth is disabled and all endpoints work as before.
# - If ATLAS_ADMIN_PASSWORD is set, protected endpoints require a valid token.

ATLAS_ADMIN_USER = os.getenv("ATLAS_ADMIN_USER", "admin")
ATLAS_ADMIN_PASSWORD = os.getenv("ATLAS_ADMIN_PASSWORD", "")
ATLAS_AUTH_TTL_SECONDS = int(os.getenv("ATLAS_AUTH_TTL_SECONDS", "86400"))  # 24h
AUTH_ENABLED = bool(ATLAS_ADMIN_PASSWORD)

# In-memory token store: token -> {user, expires_at}
_SESSIONS = {}
_bearer = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str = ""
    password: str = ""


def _now() -> int:
    return int(time.time())


def _create_session(user: str) -> dict:
    token = secrets.token_urlsafe(32)
    expires_at = _now() + ATLAS_AUTH_TTL_SECONDS
    _SESSIONS[token] = {"user": user, "expires_at": expires_at}
    return {"token": token, "user": user, "expires_at": expires_at}


def _get_token(request: Request, creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    if creds and (creds.scheme or "").lower() == "bearer" and creds.credentials:
        return creds.credentials
    # SSE/EventSource cannot send custom headers; allow token in query for streaming endpoints.
    return request.query_params.get("token", "")


def require_auth(token: str = Depends(_get_token)) -> str:
    if not AUTH_ENABLED:
        return ""  # auth disabled

    if not token:
        raise HTTPException(status_code=401, detail="Missing auth token")

    session = _SESSIONS.get(token)
    if not session:
        raise HTTPException(status_code=401, detail="Invalid auth token")

    if session.get("expires_at", 0) < _now():
        try:
            del _SESSIONS[token]
        except Exception:
            pass
        raise HTTPException(status_code=401, detail="Auth token expired")

    return session.get("user", "")

# Initialize scheduler on startup
scheduler = get_scheduler()

@app.on_event("startup")
async def startup_event():
    """Start the scheduler when the API starts."""
    logging.info("Starting scan scheduler...")
    scheduler.start()

LOGS_DIR = os.getenv("ATLAS_DATA_DIR", "/config") + "/logs"
DB_PATH  = os.getenv("ATLAS_DATA_DIR", "/config") + "/db/atlas.db"
BIN_PATH = os.getenv("ATLAS_BIN_PATH", "/config/bin/atlas")
os.makedirs(LOGS_DIR, exist_ok=True)


@app.get("/auth/enabled", tags=["Auth"])
def auth_enabled():
    return {"enabled": AUTH_ENABLED, "user": ATLAS_ADMIN_USER if AUTH_ENABLED else None}


@app.post("/auth/login", tags=["Auth"])
def auth_login(data: LoginRequest):
    if not AUTH_ENABLED:
        raise HTTPException(status_code=400, detail="Authentication is not enabled")

    username = (data.username or "").strip() or ATLAS_ADMIN_USER
    password = data.password or ""

    # Single-admin: username must match and password must match.
    if username != ATLAS_ADMIN_USER:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not secrets.compare_digest(password, ATLAS_ADMIN_PASSWORD):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return _create_session(username)


@app.get("/auth/me", tags=["Auth"])
def auth_me(user: str = Depends(require_auth)):
    if not AUTH_ENABLED:
        return {"authenticated": False, "user": None}
    return {"authenticated": True, "user": user}


@app.post("/auth/logout", tags=["Auth"])
def auth_logout(token: str = Depends(_get_token), user: str = Depends(require_auth)):
    if AUTH_ENABLED and token:
        try:
            del _SESSIONS[token]
        except Exception:
            pass
    return {"status": "ok"}

# Scripts and their log files (used for POST tee + stream)
ALLOWED_SCRIPTS = {
    "scan-hosts-fast": {
        "cmd": f"{BIN_PATH} fastscan",
        "log": os.path.join(LOGS_DIR, "scan-hosts-fast.log"),
    },
    "scan-hosts-deep": {
        "cmd": f"{BIN_PATH} deepscan",
        "log": os.path.join(LOGS_DIR, "scan-hosts-deep.log"),
    },
    "scan-docker": {
        "cmd": f"{BIN_PATH} dockerscan",
        "log": os.path.join(LOGS_DIR, "scan-docker.log"),
    },
}

@app.get("/health", tags=["Meta"])
def health():
    # Basic DB sanity: ensure hosts table exists
    db_ok = True
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='hosts'")
        exists = cur.fetchone() is not None
        conn.close()
        if not exists:
            db_ok = False
    except Exception:
        db_ok = False

    return {
        "status": "ok",
        "db": "ok" if db_ok else "init_pending",
        "version": "1.0.0",
    }

@app.get("/hosts", tags=["Hosts"])
def get_hosts(user: str = Depends(require_auth)):
    conn = sqlite3.connect(DB_PATH)
    cursor1 = conn.cursor()
    cursor2 = conn.cursor()
    cursor1.execute("SELECT * FROM hosts WHERE name IS NOT NULL AND name != '' AND name != 'NoName'")
    cursor2.execute("SELECT * FROM docker_hosts")
    rows1 = cursor1.fetchall()
    rows2 = cursor2.fetchall()
    conn.close()
    return [rows1, rows2]

@app.get("/external", tags=["Hosts"])
def get_external_networks(user: str = Depends(require_auth)):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM external_networks ORDER BY last_seen DESC LIMIT 1")
        row = cursor.fetchone()
        conn.close()
        return row if row else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# POST still supported; now tees output to a persistent log file too
@app.post("/scripts/run/{script_name}", tags=["Scripts"])
def run_named_script(script_name: str, user: str = Depends(require_auth)):
    if script_name not in ALLOWED_SCRIPTS:
        raise HTTPException(status_code=400, detail="Invalid script name")

    cmd = ALLOWED_SCRIPTS[script_name]["cmd"]
    log_file = ALLOWED_SCRIPTS[script_name]["log"]
    os.makedirs(LOGS_DIR, exist_ok=True)
    open(log_file, "a").close()  # ensure exists

    try:
        shell_cmd = f'{cmd} 2>&1 | tee -a "{log_file}"'
        logging.debug(f"Running (tee to log): {shell_cmd}")
        result = subprocess.run(["bash", "-lc", shell_cmd], capture_output=True, text=True, check=True)
        return JSONResponse(content={"status": "success", "output": result.stdout})
    except subprocess.CalledProcessError as e:
        # also persist error output
        try:
            with open(log_file, "a") as f:
                if e.stdout: f.write(e.stdout)
                if e.stderr: f.write(e.stderr)
        except Exception:
            pass
        return JSONResponse(status_code=500, content={"status": "error", "output": e.stderr})

# NEW: proper live stream endpoint that ends when the process exits
@app.get("/scripts/run/{script_name}/stream", tags=["Scripts"])
def stream_named_script(script_name: str, user: str = Depends(require_auth)):
    if script_name not in ALLOWED_SCRIPTS:
        raise HTTPException(status_code=400, detail="Invalid script name")

    cmd = ALLOWED_SCRIPTS[script_name]["cmd"]
    log_file = ALLOWED_SCRIPTS[script_name]["log"]
    os.makedirs(LOGS_DIR, exist_ok=True)
    open(log_file, "a").close()

    def event_generator():
        # Use bash -lc so pipes/aliases work if needed
        process = subprocess.Popen(
            ["bash", "-lc", cmd],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        try:
            with open(log_file, "a", buffering=1) as lf:
                for line in iter(process.stdout.readline, ''):
                    lf.write(line)
                    yield f"data: {line.rstrip()}\n\n"
            rc = process.wait()
            # Let the client know we are done; then the HTTP connection is closed
            yield f"data: [exit {rc}]\n\n"
        except GeneratorExit:
            # Client closed connection; stop the process
            try: process.kill()
            except Exception: pass
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

@app.get("/scripts/last-scan-status", tags=["Scripts"])
def last_scan_status(user: str = Depends(require_auth)):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    def get_latest(table):
        cur.execute(f"SELECT MAX(last_seen) FROM {table}")
        result = cur.fetchone()
        return result[0] if result and result[0] else None

    return {
        "fast": get_latest("hosts"),
        "deep": get_latest("hosts"),
        "docker": get_latest("docker_hosts")
    }

@app.get("/logs/list", tags=["Logs"])
def list_logs(user: str = Depends(require_auth)):
    files = []
    for name in os.listdir(LOGS_DIR):
        if not name.endswith(".log"):
            continue
        # Hide verbose per-host nmap logs from the UI list
        if name.startswith("nmap_tcp_") or name.startswith("nmap_udp_"):
            continue
        files.append(name)
    try:
        containers = subprocess.check_output(["docker", "ps", "--format", "{{.Names}}"], text=True).splitlines()
        files += [f"container:{c}" for c in containers]
    except Exception:
        pass
    return files

@app.get("/logs/{filename}", tags=["Logs"])
def read_log(filename: str, user: str = Depends(require_auth)):
    if filename.startswith("container:"):
        container = filename.split("container:")[1]
        try:
            result = subprocess.run(["docker", "logs", "--tail", "500", container], capture_output=True, text=True)
            return {"content": result.stdout}
        except Exception as e:
            return {"content": f"[ERROR] Failed to get logs for container '{container}': {str(e)}"}

    filepath = f"{LOGS_DIR}/{filename}"
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")

    with open(filepath, "r") as f:
        return {"content": f.read()}

@app.get("/logs/{filename}/download", tags=["Logs"])
def download_log(filename: str, user: str = Depends(require_auth)):
    if filename.startswith("container:"):
        container = filename.split("container:")[1]
        try:
            logs = subprocess.check_output(["docker", "logs", container], text=True)
            return Response(
                content=logs,
                media_type="text/plain",
                headers={"Content-Disposition": f"attachment; filename={container}.log"}
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to get container logs: {str(e)}")

    filepath = f"{LOGS_DIR}/{filename}"
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(filepath, filename=filename)

@app.get("/containers", tags=["Docker"])
def list_containers(user: str = Depends(require_auth)):
    try:
        output = subprocess.check_output(["docker", "ps", "--format", "{{.Names}}"], text=True)
        return output.strip().split("\n")
    except Exception:
        return []

def validate_container_name(name: str) -> str:
    """
    Validate a Docker container name to avoid passing arbitrary user input
    directly to subprocess calls.
    Only allow a restricted set of characters and a reasonable length.
    """
    # Allow common Docker name characters only and enforce a reasonable length
    if not name or len(name) > 128:
        raise HTTPException(status_code=400, detail="Invalid container name length")
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", name):
        raise HTTPException(status_code=400, detail="Invalid container name format")
    return name

def validate_log_filename(name: str) -> str:
    """
    Validate a log filename so it can be safely used to construct a path and
    passed as an argument to subprocess calls.

    NOTE: This validator only allows simple filenames (no directories). The
    allowed character set is restricted to alphanumerics plus dot, underscore,
    and hyphen, and any path separators are rejected.
    """
    if not name or len(name) > 255:
        raise HTTPException(status_code=400, detail="Invalid log filename length")
    # Disallow any path separators and restrict to a safe character set
    if "/" in name or "\\" in name:
        raise HTTPException(status_code=400, detail="Invalid log filename format")
    if not re.fullmatch(r"[a-zA-Z0-9._-]+", name):
        raise HTTPException(status_code=400, detail="Invalid log filename format")
    return name

@app.get("/logs/container/{container_name}", tags=["Docker"])
def get_container_logs(container_name: str, user: str = Depends(require_auth)):
    try:
        safe_name = validate_container_name(container_name)
        result = subprocess.run(
            ["docker", "logs", "--tail", "1000", safe_name],
            capture_output=True,
            text=True,
            check=True,
        )
        return {"logs": result.stdout}
    except subprocess.CalledProcessError as e:
        return {"logs": f"[ERROR] Failed to get logs: {e.stderr}"}

@app.get("/logs/{filename}/stream", tags=["Logs"])
def stream_log(filename: str, user: str = Depends(require_auth)):
    def event_generator():
        if filename.startswith("container:"):
            container = filename.split("container:")[1]
            safe_container = validate_container_name(container)
            cmd = ["docker", "logs", "-f", "--tail", "10", safe_container]
        else:
            safe_filename = validate_log_filename(filename)
            base_dir = os.path.abspath(LOGS_DIR)
            filepath = os.path.normpath(os.path.join(base_dir, safe_filename))
            # Ensure the resolved path stays within the logs directory
            if os.path.commonpath([base_dir, filepath]) != base_dir:
                yield "data: [ERROR] Invalid log file path\n\n"
                return
            if not os.path.exists(filepath):
                yield f"data: [ERROR] File not found: {filepath}\n\n"
                return
            # NOTE: -F follows forever; the client must close this
            cmd = ["tail", "-n", "10", "-F", filepath]

        process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            for line in process.stdout:
                yield f"data: {line.rstrip()}\n\n"
        except GeneratorExit:
            process.kill()
        except Exception as e:
            yield f"data: [ERROR] {str(e)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# ---- Devices API (MAC-keyed) ----

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/tags", tags=["Devices"])
def list_tags(user: str = Depends(require_auth)):
    """返回所有已使用的标签列表（去重排序）。"""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT DISTINCT tags FROM devices WHERE tags IS NOT NULL AND tags != ''")
        tag_set = set()
        for row in cur.fetchall():
            for t in row["tags"].split(","):
                t = t.strip()
                if t:
                    tag_set.add(t)
        return sorted(tag_set)
    finally:
        conn.close()


@app.get("/devices", tags=["Devices"])
def list_devices(show_ignored: bool = False, user: str = Depends(require_auth)):
    """List all known devices. Pass ?show_ignored=true to include hidden devices."""
    conn = get_db()
    try:
        cur = conn.cursor()
        base_filter = "d.ignored = 0 AND d.hostname IS NOT NULL AND d.hostname != '' AND d.hostname != 'NoName'"
        where = f"WHERE {base_filter}" if not show_ignored else "WHERE d.hostname IS NOT NULL AND d.hostname != '' AND d.hostname != 'NoName'"
        cur.execute(f"""
            SELECT d.mac, d.hostname, d.alias, d.current_ip, d.tags, d.os_details,
                   d.interface_name, d.next_hop, d.network_name, d.last_seen,
                   d.online_status, d.ignored,
                   COUNT(s.id) as service_count
            FROM devices d
            LEFT JOIN services s ON s.device_mac = d.mac AND s.status = 'open'
            {where}
            GROUP BY d.mac
            ORDER BY d.online_status DESC, d.last_seen DESC
        """)
        rows = [dict(r) for r in cur.fetchall()]
        return rows
    finally:
        conn.close()


@app.get("/devices/{mac}", tags=["Devices"])
def get_device(mac: str, user: str = Depends(require_auth)):
    """Get a single device with its services."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM devices WHERE mac = ?", (mac,))
        device = cur.fetchone()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")

        cur.execute("""
            SELECT id, port, proto, type, title, banner, status, source, last_seen
            FROM services WHERE device_mac = ?
            ORDER BY port
        """, (mac,))
        services = [dict(r) for r in cur.fetchall()]

        result = dict(device)
        result["services"] = services
        return result
    finally:
        conn.close()


@app.patch("/devices/{mac}", tags=["Devices"])
def update_device(mac: str, data: DeviceUpdate, user: str = Depends(require_auth)):
    """Update device hostname, tags, or ignored status."""
    conn = get_db()
    try:
        updates = {}
        if data.hostname is not None:
            updates["hostname"] = data.hostname
        if data.alias is not None:
            updates["alias"] = data.alias
        if data.tags is not None:
            updates["tags"] = data.tags
        if data.ignored is not None:
            updates["ignored"] = 1 if data.ignored else 0
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        set_clause = ", ".join(f"{k}=?" for k in updates)
        values = list(updates.values()) + [mac]
        conn.execute(f"UPDATE devices SET {set_clause} WHERE mac=?", values)

        # 如果更新了 alias，同步到 hosts 表的 name 字段
        if "alias" in updates and updates["alias"]:
            conn.execute(
                "UPDATE hosts SET name=? WHERE mac_address=?",
                (updates["alias"], mac)
            )

        conn.commit()
        return {"status": "ok", "mac": mac}
    finally:
        conn.close()


def _read_arp_mac(ip: str) -> str:
    """从 /proc/net/arp 读取指定 IP 的 MAC 地址。"""
    try:
        with open("/proc/net/arp") as f:
            next(f)  # 跳过表头
            for line in f:
                parts = line.split()
                if len(parts) >= 4 and parts[0] == ip:
                    mac = parts[3]
                    if mac and mac != "00:00:00:00:00:00":
                        return mac
    except Exception:
        pass
    return ""


@app.post("/devices", tags=["Devices"])
def create_device(data: DeviceCreate, user: str = Depends(require_auth)):
    """手动添加设备，MAC 可选（自动生成），添加后立即触发服务扫描。"""
    import uuid

    # 如果没有提供 MAC，用 IP 生成一个确定性的伪 MAC（manual:前缀）
    mac = (data.mac or "").strip()
    if not mac:
        # 用 IP 的哈希生成固定 MAC，格式 "ma:nu:al:xx:xx:xx"
        h = uuid.uuid5(uuid.NAMESPACE_DNS, data.current_ip).hex
        mac = f"ma:nu:al:{h[0:2]}:{h[2:4]}:{h[4:6]}"

    conn = get_db()
    try:
        conn.execute("""
            INSERT INTO devices (mac, hostname, alias, current_ip, tags, os_details, network_name, online_status)
            VALUES (?, ?, ?, ?, ?, ?, 'manual', 'online')
            ON CONFLICT(mac) DO UPDATE SET
                hostname=excluded.hostname,
                alias=excluded.alias,
                current_ip=excluded.current_ip,
                tags=excluded.tags,
                os_details=excluded.os_details
        """, (mac, data.hostname, data.alias or "", data.current_ip, data.tags or "", data.os_details or ""))

        # 同步写入 hosts 表，让 HostsTable 也能看到
        conn.execute("""
            INSERT INTO hosts (ip, name, os_details, mac_address, open_ports, next_hop, network_name, interface_name, online_status)
            VALUES (?, ?, ?, ?, 'Unknown', '', 'manual', 'manual', 'online')
            ON CONFLICT(ip, interface_name) DO UPDATE SET
                name=excluded.name,
                os_details=excluded.os_details,
                mac_address=excluded.mac_address,
                online_status='online'
        """, (data.current_ip, data.alias or data.hostname, data.os_details or "", mac))

        conn.commit()
    finally:
        conn.close()

    # 立即在后台触发服务扫描（同时尝试获取真实 MAC）
    import threading
    def run_scan():
        try:
            env = os.environ.copy()
            # 确保 Go 二进制能找到数据库
            env.setdefault("ATLAS_DATA_DIR", os.getenv("ATLAS_DATA_DIR", "/config"))

            # 先 ping 一次，让内核更新 ARP 表
            subprocess.run(["ping", "-c", "1", "-W", "1", data.current_ip],
                           capture_output=True, env=env)

            # 尝试从 ARP 表读取真实 MAC 并更新数据库
            real_mac = _read_arp_mac(data.current_ip)
            if real_mac and real_mac != mac:
                conn2 = get_db()
                try:
                    # 把伪 MAC 记录迁移到真实 MAC
                    conn2.execute("""
                        INSERT INTO devices (mac, hostname, current_ip, tags, os_details, network_name, online_status)
                        VALUES (?, ?, ?, ?, ?, 'manual', 'online')
                        ON CONFLICT(mac) DO UPDATE SET
                            hostname=excluded.hostname, current_ip=excluded.current_ip,
                            tags=excluded.tags, os_details=excluded.os_details
                    """, (real_mac, data.hostname, data.current_ip, data.tags or "", data.os_details or ""))
                    conn2.execute("DELETE FROM devices WHERE mac=?", (mac,))
                    conn2.commit()
                    scan_mac = real_mac
                except Exception:
                    scan_mac = mac
                finally:
                    conn2.close()
            else:
                scan_mac = mac

            # 触发服务扫描
            subprocess.run(
                [BIN_PATH, "servicescan", data.current_ip, scan_mac],
                capture_output=True, timeout=120, env=env
            )
        except Exception as e:
            logging.warning(f"Service scan failed for {data.current_ip}: {e}")
    threading.Thread(target=run_scan, daemon=True).start()

    return {"status": "ok", "mac": mac, "scan": "started"}


@app.delete("/devices/{mac}", tags=["Devices"])
def delete_device(mac: str, user: str = Depends(require_auth)):
    """删除设备及其服务，同步清理 hosts 表。"""
    conn = get_db()
    try:
        # 先查出 IP，用于清理 hosts 表
        cur = conn.cursor()
        cur.execute("SELECT current_ip FROM devices WHERE mac=?", (mac,))
        row = cur.fetchone()
        ip = row["current_ip"] if row else None

        conn.execute("DELETE FROM services WHERE device_mac=?", (mac,))
        conn.execute("DELETE FROM devices WHERE mac=?", (mac,))
        if ip:
            conn.execute("DELETE FROM hosts WHERE ip=? AND mac_address=?", (ip, mac))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@app.post("/services", tags=["Services"])
def create_service(data: ServiceCreate, user: str = Depends(require_auth)):
    """Manually add a service to a device."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT mac FROM devices WHERE mac=?", (data.device_mac,))
        if not cur.fetchone():
            raise HTTPException(status_code=404, detail="Device not found")
        conn.execute("""
            INSERT INTO services (device_mac, port, proto, type, title, banner, status, source)
            VALUES (?, ?, ?, ?, ?, ?, 'open', 'manual')
            ON CONFLICT(device_mac, port, proto) DO UPDATE SET
                type=excluded.type, title=excluded.title,
                banner=excluded.banner, status='open', source='manual',
                last_seen=CURRENT_TIMESTAMP
        """, (data.device_mac, data.port, data.proto, data.type, data.title, data.banner))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@app.delete("/services/{service_id}", tags=["Services"])
def delete_service(service_id: int, user: str = Depends(require_auth)):
    """Delete a service entry."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM services WHERE id=?", (service_id,))
        conn.commit()
        return {"status": "ok"}
    finally:
        conn.close()


@app.get("/devices/{mac}/services", tags=["Devices"])
def get_device_services(mac: str, user: str = Depends(require_auth)):
    """Get all services for a device."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, port, proto, type, title, banner, status, source, last_seen
            FROM services WHERE device_mac = ?
            ORDER BY port
        """, (mac,))
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@app.get("/services", tags=["Services"])
def list_all_services(
    status: str = "open",
    type: str = None,
    user: str = Depends(require_auth)
):
    """List all services across all devices, grouped by device."""
    conn = get_db()
    try:
        cur = conn.cursor()
        query = """
            SELECT s.id, s.device_mac, s.port, s.proto, s.type, s.title,
                   s.banner, s.status, s.last_seen,
                   d.hostname, d.current_ip, d.tags, d.online_status as device_status
            FROM services s
            JOIN devices d ON d.mac = s.device_mac
            WHERE s.status = ?
        """
        params = [status]
        if type:
            query += " AND s.type = ?"
            params.append(type)
        query += " ORDER BY d.current_ip, s.port"
        cur.execute(query, params)
        return [dict(r) for r in cur.fetchall()]
    finally:
        conn.close()


@app.post("/devices/{mac}/refresh", tags=["Devices"])
def refresh_device(mac: str, user: str = Depends(require_auth)):
    """按 MAC 重新扫描设备：更新 IP（从 hosts 表同步）并触发服务扫描。"""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT * FROM devices WHERE mac=?", (mac,))
        device = cur.fetchone()
        if not device:
            raise HTTPException(status_code=404, detail="Device not found")
        device = dict(device)
    finally:
        conn.close()

    import threading
    def run():
        try:
            env = os.environ.copy()
            env.setdefault("ATLAS_DATA_DIR", os.getenv("ATLAS_DATA_DIR", "/config"))
            ip = device.get("current_ip", "")
            if not ip:
                return

            # ping 触发 ARP 更新
            subprocess.run(["ping", "-c", "1", "-W", "1", ip],
                           capture_output=True, env=env)

            # 尝试从 ARP 表获取最新 MAC（如果是伪 MAC 则尝试替换）
            real_mac = _read_arp_mac(ip)
            scan_mac = real_mac if real_mac else mac

            # 更新 devices 表的 online_status
            conn2 = get_db()
            try:
                conn2.execute(
                    "UPDATE devices SET online_status='online', last_seen=CURRENT_TIMESTAMP WHERE mac=?",
                    (mac,)
                )
                conn2.commit()
            finally:
                conn2.close()

            # 触发服务扫描
            subprocess.run(
                [BIN_PATH, "servicescan", ip, scan_mac],
                capture_output=True, timeout=120, env=env
            )
        except Exception as e:
            logging.warning(f"Refresh failed for {mac}: {e}")

    threading.Thread(target=run, daemon=True).start()
    return {"status": "started", "mac": mac}
def refresh_device_services(mac: str, user: str = Depends(require_auth)):
    """Trigger a service re-scan for a specific device (runs in background)."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT current_ip FROM devices WHERE mac=?", (mac,))
        row = cur.fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Device not found")
        ip = row["current_ip"]
    finally:
        conn.close()

    if not ip:
        raise HTTPException(status_code=400, detail="Device has no current IP")

    # Run service scan asynchronously via atlas binary
    import threading
    def run_scan():
        env = os.environ.copy()
        env.setdefault("ATLAS_DATA_DIR", os.getenv("ATLAS_DATA_DIR", "/config"))
        subprocess.run([BIN_PATH, "servicescan", ip, mac], capture_output=True, env=env)
    threading.Thread(target=run_scan, daemon=True).start()
    return {"status": "started", "mac": mac, "ip": ip}


# ---- Service ports config ----

DEFAULT_SERVICE_PORTS = [21, 22, 23, 25, 53, 80, 443, 3000, 3306, 5173, 5432, 6379, 8080, 8443, 8888, 9090,8848]


@app.get("/config/service-ports", tags=["Config"])
def get_service_ports(user: str = Depends(require_auth)):
    """Get the current list of ports to scan for services."""
    conn = get_db()
    try:
        cur = conn.cursor()
        cur.execute("SELECT value FROM settings WHERE key='service_ports'")
        row = cur.fetchone()
        if row:
            ports = [int(p.strip()) for p in row["value"].split(",") if p.strip().isdigit()]
            return {"ports": ports, "source": "custom"}
        return {"ports": DEFAULT_SERVICE_PORTS, "source": "default"}
    finally:
        conn.close()


@app.put("/config/service-ports", tags=["Config"])
def set_service_ports(data: ServicePortsUpdate, user: str = Depends(require_auth)):
    """Set the list of ports to scan for services."""
    if not data.ports:
        raise HTTPException(status_code=400, detail="ports list cannot be empty")
    invalid = [p for p in data.ports if not (1 <= p <= 65535)]
    if invalid:
        raise HTTPException(status_code=400, detail=f"Invalid port numbers: {invalid}")

    value = ",".join(str(p) for p in sorted(set(data.ports)))
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('service_ports', ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (value,)
        )
        conn.commit()
        return {"ports": sorted(set(data.ports)), "source": "custom"}
    finally:
        conn.close()


@app.delete("/config/service-ports", tags=["Config"])
def reset_service_ports(user: str = Depends(require_auth)):
    """Reset port list to defaults."""
    conn = get_db()
    try:
        conn.execute("DELETE FROM settings WHERE key='service_ports'")
        conn.commit()
        return {"ports": DEFAULT_SERVICE_PORTS, "source": "default"}
    finally:
        conn.close()


@app.get("/scheduler/intervals", tags=["Scheduler"])
def get_scheduler_intervals(user: str = Depends(require_auth)):
    """Get current scan intervals for all scan types."""
    return scheduler.get_intervals()

@app.put("/scheduler/intervals/{scan_type}", tags=["Scheduler"])
def update_scheduler_interval(scan_type: str, data: IntervalUpdate, user: str = Depends(require_auth)):
    """Update the interval for a specific scan type."""
    try:
        scheduler.update_interval(scan_type, data.interval)
        return {"status": "success", "scan_type": scan_type, "interval": data.interval}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/scheduler/status", tags=["Scheduler"])
def get_scheduler_status(user: str = Depends(require_auth)):
    """Get scheduler status."""
    return {
        "running": scheduler.is_running(),
        "intervals": scheduler.get_intervals()
    }
