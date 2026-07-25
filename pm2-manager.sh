#!/usr/bin/env bash
#
# pm2-manager.sh — manage the x-copilot API for this instance.
#
# Services (see ecosystem.config.cjs — copy from ecosystem.config.example.cjs):
#   x-copilot-api   TypeScript sidecar (session + drafts) on :8787
#
# Usage:
#   ./pm2-manager.sh start              build server, then start API
#   ./pm2-manager.sh stop               stop managed apps
#   ./pm2-manager.sh restart [prod]     build, restart API (does NOT wipe logs)
#   ./pm2-manager.sh restart --skip-build
#   ./pm2-manager.sh status             show pm2 status
#   ./pm2-manager.sh logs [name]        tail logs (default: x-copilot-api)
#   ./pm2-manager.sh save               persist process list for boot resurrection
#   ./pm2-manager.sh setup-logrotate    install/configure pm2-logrotate
#   ./pm2-manager.sh delete             remove apps from pm2
#
# Logs live under ./logs/ and are never truncated by this script.
#
set -euo pipefail

cd "$(dirname "$0")"
mkdir -p logs

ECOSYSTEM="ecosystem.config.cjs"
CORE="x-copilot-api"

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found. Install it: npm i -g pm2" >&2
  exit 1
fi

require_ecosystem() {
  if [ ! -f "$ECOSYSTEM" ]; then
    echo "Missing $ECOSYSTEM." >&2
    echo "Copy the example first:" >&2
    echo "  cp ecosystem.config.example.cjs ecosystem.config.cjs" >&2
    exit 1
  fi
}

ensure_build() {
  if [ "${SKIP_BUILD:-}" = "1" ] && [ -f "server/dist/index.js" ]; then
    echo "Skipping build (--skip-build, server/dist present)."
    return
  fi
  echo "Installing deps + building server before start..."
  npm install --no-audit --no-fund
  npm run build:server
}

setup_logrotate() {
  echo "Installing pm2-logrotate module (safe if already installed)..."
  pm2 install pm2-logrotate
  # Rotate in place under project logs/; do not rely on wipe-on-restart.
  pm2 set pm2-logrotate:max_size 10M
  pm2 set pm2-logrotate:retain 14
  pm2 set pm2-logrotate:compress true
  pm2 set pm2-logrotate:dateFormat YYYY-MM-DD_HH-mm-ss
  pm2 set pm2-logrotate:workerInterval 30
  pm2 set pm2-logrotate:rotateInterval "0 0 * * *"
  echo "pm2-logrotate configured (max_size=10M, retain=14, compress=true)."
}

cmd="${1:-status}"
shift || true
SKIP_BUILD=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD="1" ;;
    prod) ;; # no-op alias for ./pm2-manager.sh restart prod
  esac
done

case "$cmd" in
  start)
    require_ecosystem
    ensure_build
    mkdir -p logs
    pm2 start "$ECOSYSTEM" --only "$CORE"
    ;;
  stop)
    require_ecosystem
    pm2 stop "$ECOSYSTEM" || true
    ;;
  restart)
    require_ecosystem
    ensure_build
    mkdir -p logs
    # Restart without truncating or deleting anything under logs/
    if pm2 describe "$CORE" >/dev/null 2>&1; then
      pm2 restart "$CORE" --update-env
    else
      pm2 start "$ECOSYSTEM" --only "$CORE"
    fi
    ;;
  delete)
    require_ecosystem
    pm2 delete "$ECOSYSTEM" || true
    ;;
  status)
    pm2 list
    ;;
  logs)
    if [ "${1:-}" != "" ]; then
      pm2 logs "$1"
    else
      pm2 logs "$CORE"
    fi
    ;;
  save)
    pm2 save
    ;;
  setup-logrotate)
    setup_logrotate
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    echo "Use: start | stop | restart [prod] | delete | status | logs [name] | save | setup-logrotate" >&2
    echo "Flags: --skip-build" >&2
    exit 1
    ;;
esac
