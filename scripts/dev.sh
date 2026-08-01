#!/usr/bin/env bash
# Ledger local dev servers.
#
#   ./scripts/dev.sh start    start backend (:8000) + frontend (:3100), detached
#   ./scripts/dev.sh stop     stop whatever is LISTENING on :8000 and :3100
#   ./scripts/dev.sh status   health check both
#
# Note: `stop` kills the listener on those ports whoever owns it — if another
# project is on :3100, stop that one first or start it on a different port.

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_PORT=8000
FRONTEND_PORT=3100

listener() { lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null || true; }

start() {
  if [ -z "$(listener $BACKEND_PORT)" ]; then
    (cd "$ROOT/backend" && nohup uv run uvicorn app.main:app --reload --port $BACKEND_PORT \
      >/tmp/ledger-backend.log 2>&1 &)
    echo "backend  → starting on :$BACKEND_PORT   (logs: /tmp/ledger-backend.log)"
  else
    echo "backend  → already listening on :$BACKEND_PORT"
  fi
  if [ -z "$(listener $FRONTEND_PORT)" ]; then
    (cd "$ROOT/frontend" && nohup npm run dev -- --port $FRONTEND_PORT \
      >/tmp/ledger-frontend.log 2>&1 &)
    echo "frontend → starting on :$FRONTEND_PORT   (logs: /tmp/ledger-frontend.log)"
  else
    echo "frontend → port :$FRONTEND_PORT already in use; './scripts/dev.sh stop' first"
  fi
}

stop() {
  for port in $BACKEND_PORT $FRONTEND_PORT; do
    pids="$(listener "$port")"
    if [ -n "$pids" ]; then
      echo "stopping listener on :$port (pid $pids)"
      kill $pids 2>/dev/null || true
      for _ in $(seq 1 20); do
        [ -z "$(listener "$port")" ] && break
        sleep 0.25
      done
    else
      echo "nothing listening on :$port"
    fi
  done
}

status() {
  if curl -s --max-time 3 "localhost:$BACKEND_PORT/healthz"; then echo; else echo "backend  → down"; fi
  if [ -n "$(listener $FRONTEND_PORT)" ]; then
    echo "frontend → up on http://localhost:$FRONTEND_PORT"
  else
    echo "frontend → down"
  fi
}

case "${1:-status}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 start|stop|status" ;;
esac
