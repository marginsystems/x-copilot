#!/usr/bin/env bash
#
# analytics/pm2-manager.sh — Slack sidecar only (x-copilot-analytics on :8788).
# Independent of the API/stats recycle. The API still fire-and-forgets
# POST /event to ANALYTICS_URL; a down sidecar does not affect takeoff.
#
# Usage:
#   ./analytics/pm2-manager.sh start
#   ./analytics/pm2-manager.sh restart
#   ./analytics/pm2-manager.sh restart --skip-build
#   ./analytics/pm2-manager.sh stop
#   ./analytics/pm2-manager.sh status
#   ./analytics/pm2-manager.sh logs
#   ./analytics/pm2-manager.sh delete
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p logs

ECOSYSTEM="analytics/ecosystem.config.cjs"
NAME="x-copilot-analytics"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found. Install it: npm i -g pm2" >&2
  exit 1
fi

ensure_build() {
  if [ "${SKIP_BUILD:-}" = "1" ] && [ -f "analytics/dist/sidecar.js" ]; then
    echo "Skipping build (--skip-build, analytics/dist present)."
    return
  fi
  echo "Building analytics sidecar..."
  npm run build:analytics
}

recycle_app() {
  if pm2 describe "$NAME" >/dev/null 2>&1; then
    pm2 restart "$NAME" --update-env
  else
    pm2 start "$ECOSYSTEM" --only "$NAME"
  fi
}

cmd="${1:-status}"
shift || true
SKIP_BUILD=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD="1" ;;
  esac
done

case "$cmd" in
  start)
    ensure_build
    pm2 start "$ECOSYSTEM" --only "$NAME"
    ;;
  stop)
    pm2 stop "$NAME" || true
    ;;
  restart)
    ensure_build
    recycle_app
    ;;
  delete)
    pm2 delete "$NAME" || true
    ;;
  status)
    pm2 describe "$NAME" || pm2 list
    ;;
  logs)
    pm2 logs "$NAME"
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "Use: start | stop | restart | delete | status | logs" >&2
    echo "Flags: --skip-build" >&2
    exit 1
    ;;
esac
