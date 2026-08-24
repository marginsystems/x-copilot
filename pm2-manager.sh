#!/usr/bin/env bash
#
# pm2-manager.sh — manage the x-copilot API for this instance.
#
# Services (see ecosystem.config.cjs — copy from ecosystem.config.example.cjs):
#   x-copilot-api        TypeScript sidecar (session + drafts) on :8787
#   x-copilot-stats      Hourly reply-stats sampler (1h / 24h snapshots)
#   x-copilot-analytics  Loopback Slack sidecar on :8788 (code in analytics/)
#
# Usage:
#   ./pm2-manager.sh start              build server, then start API + stats + analytics
#   ./pm2-manager.sh stop               stop managed apps
#   ./pm2-manager.sh restart [prod]     build, recycle API + stats + analytics from ecosystem + .env
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
STATS="x-copilot-stats"
ANALYTICS="x-copilot-analytics"
APPS=("$CORE" "$STATS" "$ANALYTICS")

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

# A machine-local $ECOSYSTEM that predates the analytics sidecar move either
# defines no $ANALYTICS app or inlines an old analytics app pointing at
# server/dist/analyticsService.js (no longer built), so `pm2 start --only
# $ANALYTICS` aborts or crash-loops with no migration hint. The tracked example
# requires analytics/ecosystem.config.cjs; any config that does not is stale
# (the app name itself never appears in the root file, only in the required
# analytics/ecosystem.config.cjs). Point the operator back at the tracked
# example instead.
require_analytics_app() {
  if ! grep -q "analytics/ecosystem.config.cjs" "$ECOSYSTEM"; then
    echo "$ECOSYSTEM predates the analytics sidecar move (no analytics app at analytics/)." >&2
    echo "Re-sync with the tracked example, keeping machine-local tweaks:" >&2
    echo "  cp ecosystem.config.example.cjs ecosystem.config.cjs" >&2
    exit 1
  fi
}

ensure_build() {
  if [ "${SKIP_BUILD:-}" = "1" ] && [ -f "server/dist/index.js" ] && [ -f "analytics/dist/sidecar.js" ]; then
    echo "Skipping build (--skip-build, server/dist and analytics/dist present)."
    return
  fi
  echo "Installing deps + building server and analytics sidecar before start..."
  npm install --no-audit --no-fund
  npm run build:server
  npm run build:analytics
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

# Secrets are not carried in the ecosystem `env` block (that would serialize
# them into ~/.pm2/dump.pm2 via `pm2 save`). Each process loads .env at boot
# with override, so any restart picks up rotated keys and stale ones cannot
# stick. Keep the recycle non-destructive: delete+start would leave the app
# down if the fresh start fails, so restart --update-env for NODE_ENV/PORT.
#
# PM2 restart reuses the process's stored definition, not the ecosystem file.
# A registration that predates the analytics sidecar move still points at
# server/dist/analyticsService.js, so a restart would keep recycling the OLD
# sidecar forever (crash-looping once server/dist is cleaned). Detect that by
# comparing the stored script against the ecosystem entry and re-register
# (delete+start) only when they differ; that keeps the one-time migration
# while leaving steady-state recycling non-destructive.
recycle_app() {
  local name="$1"
  if pm2 describe "$name" >/dev/null 2>&1; then
    if node -e '
      const path = require("node:path");
      const { execSync } = require("node:child_process");
      const [root, ecosystem, name] = process.argv.slice(1);
      const app = require(path.resolve(ecosystem)).apps.find((a) => a.name === name);
      const expected = app && path.resolve(root, app.script);
      let stored;
      try {
        stored = JSON.parse(execSync("pm2 jlist", { stdio: ["ignore", "pipe", "ignore"] }).toString());
      } catch {
        process.exit(1);
      }
      const proc = stored.find((p) => p.name === name);
      process.exit(app && proc && proc.pm2_env.pm_exec_path === expected ? 0 : 1);
    ' "$PWD" "$ECOSYSTEM" "$name"; then
      pm2 restart "$name" --update-env
    else
      pm2 delete "$name" >/dev/null 2>&1 || true
      pm2 start "$ECOSYSTEM" --only "$name"
      pm2 save
    fi
  else
    pm2 start "$ECOSYSTEM" --only "$name"
  fi
}

case "$cmd" in
  start)
    require_ecosystem
    require_analytics_app
    ensure_build
    mkdir -p logs
    for name in "${APPS[@]}"; do
      recycle_app "$name"
    done
    ;;
  stop)
    require_ecosystem
    pm2 stop "$ECOSYSTEM" || true
    ;;
  restart)
    require_ecosystem
    require_analytics_app
    ensure_build
    mkdir -p logs
    # Recycle without truncating or deleting anything under logs/
    for name in "${APPS[@]}"; do
      recycle_app "$name"
    done
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
