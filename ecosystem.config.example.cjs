// PM2 process definitions for x-copilot. Run via ./pm2-manager.sh.
//
// Setup (once per machine):
//   cp ecosystem.config.example.cjs ecosystem.config.cjs
//   ./pm2-manager.sh setup-logrotate   # optional but recommended
//   ./pm2-manager.sh start
//
// ecosystem.config.cjs is gitignored — do not commit machine-local copies.
// Secrets live in .env and are read by each process via loadEnv at startup
// (with override), so a recycle picks up rotated keys and stale ones cannot
// stick. Only NODE_ENV/PORT are pinned here; loadEnv never overrides them.
//
// Slack sidecar lives in analytics/ — recycle it alone with
// ./analytics/pm2-manager.sh. This file requires that app list.

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const tsx = path.join(root, "node_modules", ".bin", "tsx");
const analyticsApps = require("./analytics/ecosystem.config.cjs").apps;

function runner(distEntry, srcEntry) {
  const dist = path.join(root, distEntry);
  if (fs.existsSync(dist)) {
    // PM2 `script` is the entry file; node interpreter is set explicitly
    return { script: distEntry, interpreter: "node" };
  }
  return { script: srcEntry, interpreter: tsx };
}

const api = runner("server/dist/index.js", "server/src/index.ts");
const stats = runner("server/dist/statsWorker.js", "server/src/statsWorker.ts");

module.exports = {
  apps: [
    {
      name: "x-copilot-api",
      script: api.script,
      ...(api.interpreter ? { interpreter: api.interpreter } : {}),
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "8787",
        ANALYTICS_URL: "http://127.0.0.1:8788",
        // BIND_HOST: "0.0.0.0", // only behind Cloudflare TLS; see docs/PUBLIC_DEPLOY.md
      },
      out_file: path.join(root, "logs", "x-copilot-api.out.log"),
      error_file: path.join(root, "logs", "x-copilot-api.err.log"),
    },
    {
      name: "x-copilot-stats",
      script: stats.script,
      ...(stats.interpreter ? { interpreter: stats.interpreter } : {}),
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: "production",
      },
      out_file: path.join(root, "logs", "x-copilot-stats.out.log"),
      error_file: path.join(root, "logs", "x-copilot-stats.err.log"),
    },
    ...analyticsApps,
  ],
};
