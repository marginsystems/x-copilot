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

# PM2 restart reuses the process's stored definition, not the ecosystem file.
# A registration that predates the analytics sidecar move still points at
# server/dist/analyticsService.js, so a restart would keep recycling the OLD
# sidecar forever (crash-looping once server/dist is cleaned). Re-register
# (delete+start) only when the stored script differs from the ecosystem entry;
# steady-state recycling stays non-destructive (restart --update-env).
recycle_app() {
  if pm2 describe "$NAME" >/dev/null 2>&1; then
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
    ' "$PWD" "$ECOSYSTEM" "$NAME"; then
      pm2 restart "$NAME" --update-env
    else
      pm2 delete "$NAME" >/dev/null 2>&1 || true
      pm2 start "$ECOSYSTEM" --only "$NAME"
      pm2 save
    fi
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
    recycle_app
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
