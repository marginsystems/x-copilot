#!/usr/bin/env bash
#
# pm2-manager.sh — one operator script for this instance.
#
# Services (see ecosystem.config.cjs — copy from ecosystem.config.example.cjs):
#   x-copilot-api        TypeScript sidecar (session + drafts) on :8787
#   x-copilot-stats      Hourly reply-stats sampler (1h / 24h snapshots)
#   x-copilot-analytics  Loopback Slack sidecar on :8788 (code in analytics/)
#
# Profiles select which apps a command touches. Default is all.
#
# Usage:
#   ./pm2-manager.sh start [all|api|stats|analytics]
#   ./pm2-manager.sh restart [all|prod|api|stats|analytics]
#   ./pm2-manager.sh restart analytics --skip-build
#   ./pm2-manager.sh stop [all|api|stats|analytics]
#   ./pm2-manager.sh delete [all|api|stats|analytics]
#   ./pm2-manager.sh status
#   ./pm2-manager.sh logs [api|stats|analytics|name]
#   ./pm2-manager.sh save
#   ./pm2-manager.sh setup-logrotate
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

if ! command -v pm2 >/dev/null 2>&1; then
  echo "pm2 not found. Install it: npm i -g pm2" >&2
  exit 1
fi

usage() {
  echo "Use: start | stop | restart | delete | status | logs | save | setup-logrotate" >&2
  echo "Profiles: all | prod | api | stats | analytics" >&2
  echo "Flags: --skip-build" >&2
}

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
# server/dist/analyticsService.js (no longer built). The tracked example
# requires analytics/ecosystem.config.cjs; any config that does not is stale.
require_analytics_app() {
  if ! grep -q "analytics/ecosystem.config.cjs" "$ECOSYSTEM"; then
    echo "$ECOSYSTEM predates the analytics sidecar move (no analytics app at analytics/)." >&2
    echo "Re-sync with the tracked example, keeping machine-local tweaks:" >&2
    echo "  cp ecosystem.config.example.cjs ecosystem.config.cjs" >&2
    exit 1
  fi
}

cmd="${1:-status}"
shift || true
PROFILE="all"
SKIP_BUILD=""
LOG_NAME=""

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD="1" ;;
    prod|all) PROFILE="all" ;;
    api|core|"$CORE") PROFILE="api" ;;
    stats|"$STATS") PROFILE="stats" ;;
    analytics|"$ANALYTICS") PROFILE="analytics" ;;
    *)
      if [ "$cmd" = "logs" ] && [ -z "$LOG_NAME" ]; then
        LOG_NAME="$arg"
      else
        echo "Unknown argument: $arg" >&2
        usage
        exit 1
      fi
      ;;
  esac
done

case "$PROFILE" in
  all) APPS=("$CORE" "$STATS" "$ANALYTICS") ;;
  api) APPS=("$CORE") ;;
  stats) APPS=("$STATS") ;;
  analytics) APPS=("$ANALYTICS") ;;
esac

needs_server_build() {
  [ "$PROFILE" = "all" ] || [ "$PROFILE" = "api" ] || [ "$PROFILE" = "stats" ]
}

needs_analytics_build() {
  [ "$PROFILE" = "all" ] || [ "$PROFILE" = "analytics" ]
}

ensure_build() {
  local have_server=0 have_analytics=0
  [ -f "server/dist/index.js" ] && have_server=1
  [ -f "analytics/dist/sidecar.js" ] && have_analytics=1

  if [ "${SKIP_BUILD:-}" = "1" ]; then
    if needs_server_build && [ "$have_server" != "1" ]; then
      echo "Cannot --skip-build: server/dist/index.js is missing." >&2
      exit 1
    fi
    if needs_analytics_build && [ "$have_analytics" != "1" ]; then
      echo "Cannot --skip-build: analytics/dist/sidecar.js is missing." >&2
      exit 1
    fi
    echo "Skipping build (--skip-build, required dist present for profile=$PROFILE)."
    return
  fi

  echo "Installing deps + building profile=$PROFILE..."
  npm install --no-audit --no-fund
  if needs_server_build; then
    npm run build:server
  fi
  if needs_analytics_build; then
    npm run build:analytics
  fi
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
    # Exit 0: stored script matches the ecosystem entry (restart in place).
    # Exit 1: genuine mismatch (re-register, the one-time migration path).
    # Exit 2: comparison itself failed (pm2 jlist / config parse) or no
    # same-named process under this project root (foreign process from another
    # project in the shared daemon) — unknown state, so stay non-destructive
    # and restart in place instead of delete+start.
    local rc=0
    node -e '
      const path = require("node:path");
      const { execSync } = require("node:child_process");
      const [root, ecosystem, name] = process.argv.slice(1);
      let app, expected;
      try {
        app = require(path.resolve(ecosystem)).apps.find((a) => a.name === name);
        expected = app && path.resolve(root, app.script);
      } catch {
        process.exit(2);
      }
      let stored;
      try {
        stored = JSON.parse(execSync("pm2 jlist", { stdio: ["ignore", "pipe", "ignore"] }).toString());
      } catch {
        process.exit(2);
      }
      const proc = stored.find((p) => p.name === name && p.pm2_env && p.pm2_env.pm_exec_path && p.pm2_env.pm_exec_path.startsWith(path.resolve(root) + path.sep));
      process.exit(app && proc && proc.pm2_env.pm_exec_path === expected ? 0 : proc ? 1 : 2);
    ' "$PWD" "$ECOSYSTEM" "$name" || rc=$?
    if [ "$rc" = "0" ] || [ "$rc" = "2" ]; then
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

recycle_profile() {
  require_ecosystem
  if needs_analytics_build; then
    require_analytics_app
  fi
  ensure_build
  mkdir -p logs
  for name in "${APPS[@]}"; do
    recycle_app "$name"
  done
}

case "$cmd" in
  start|restart)
    recycle_profile
    ;;
  stop)
    require_ecosystem
    if [ "$PROFILE" = "all" ]; then
      pm2 stop "$ECOSYSTEM" || true
    else
      for name in "${APPS[@]}"; do
        pm2 stop "$name" || true
      done
    fi
    ;;
  delete)
    require_ecosystem
    if [ "$PROFILE" = "all" ]; then
      pm2 delete "$ECOSYSTEM" || true
    else
      for name in "${APPS[@]}"; do
        pm2 delete "$name" || true
      done
    fi
    ;;
  status)
    pm2 list
    ;;
  logs)
    if [ -n "$LOG_NAME" ]; then
      pm2 logs "$LOG_NAME"
    else
      case "$PROFILE" in
        stats) pm2 logs "$STATS" ;;
        analytics) pm2 logs "$ANALYTICS" ;;
        *) pm2 logs "$CORE" ;;
      esac
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
    usage
    exit 1
    ;;
esac
