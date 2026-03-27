#!/bin/bash
# Local development startup script (no Docker)
# Run from repo root: bash config/scripts/dev.sh
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="$REPO_ROOT/config/scripts"
API_PORT="${ATLAS_API_PORT:-8889}"
UI_PORT="${ATLAS_UI_PORT:-5173}"
DATA_DIR="$REPO_ROOT/config"
BIN_PATH="$DATA_DIR/bin/atlas"

log() { echo "$(date '+%H:%M:%S') $1"; }

# ── 1. Build Go binary ──────────────────────────────────────────────────────
log "🔨 Building Go scanner..."
cd "$REPO_ROOT/config/atlas_go"
go build -o "$REPO_ROOT/config/bin/atlas" .
cd "$REPO_ROOT"
log "✅ Go binary built → config/bin/atlas"

# ── 2. Init DB ──────────────────────────────────────────────────────────────
mkdir -p "$DATA_DIR/db" "$DATA_DIR/logs"
log "📦 Initializing database..."
ATLAS_DATA_DIR="$DATA_DIR" "$BIN_PATH" initdb
log "✅ DB ready → config/db/atlas.db"

# ── 3. Start FastAPI ─────────────────────────────────────────────────────────
VENV_UVICORN=""
for venv_dir in "$SCRIPTS_DIR/venv" "$SCRIPTS_DIR/.venv"; do
  if [[ -x "$venv_dir/bin/uvicorn" ]]; then
    VENV_UVICORN="$venv_dir/bin/uvicorn"
    log "🐍 Using virtualenv: $venv_dir"
    break
  fi
done

if [[ -z "$VENV_UVICORN" ]]; then
  VENV_UVICORN="$(command -v uvicorn 2>/dev/null || true)"
  if [[ -z "$VENV_UVICORN" ]]; then
    log "❌ uvicorn not found. Create a venv first:"
    log "   python3 -m venv config/scripts/venv"
    log "   config/scripts/venv/bin/pip install fastapi==0.121.0 uvicorn==0.38.0"
    exit 1
  fi
  log "🐍 Using system uvicorn: $VENV_UVICORN"
fi

log "🚀 Starting FastAPI on port $API_PORT..."
PYTHONPATH="$REPO_ROOT/config" \
ATLAS_DATA_DIR="$DATA_DIR" \
ATLAS_BIN_PATH="$BIN_PATH" \
  "$VENV_UVICORN" scripts.app:app \
    --host 0.0.0.0 \
    --port "$API_PORT" \
    --reload \
    --app-dir "$REPO_ROOT/config" \
  > "$REPO_ROOT/config/logs/uvicorn.log" 2>&1 &
API_PID=$!
log "   PID $API_PID  |  API docs → http://localhost:$API_PORT/api/docs"

for i in $(seq 1 15); do
  if curl -sf "http://localhost:$API_PORT/health" > /dev/null 2>&1; then
    log "✅ FastAPI is up"
    break
  fi
  sleep 1
done

# ── 4. Start React dev server ────────────────────────────────────────────────
log "⚛️  Starting React dev server on port $UI_PORT..."
cd "$REPO_ROOT/data/react-ui"
npm install --silent
VITE_API_PORT="$API_PORT" npm run dev &
UI_PID=$!
cd "$REPO_ROOT"

log ""
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "  UI  →  http://localhost:$UI_PORT"
log "  API →  http://localhost:$API_PORT/api/docs"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Press Ctrl+C to stop all services"

trap "log '🛑 Stopping...'; kill $API_PID $UI_PID 2>/dev/null; exit 0" INT TERM

wait
