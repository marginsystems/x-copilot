// PM2 process for the Slack analytics sidecar only.
// Recycle with ./analytics/pm2-manager.sh — or via the root manager,
// which requires this file into the full ecosystem.
//
// cwd is the repo root so loadEnv still reads ./.env.
// Secrets stay in .env. Only NODE_ENV/PORT are pinned here.

const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const tsx = path.join(root, "node_modules", ".bin", "tsx");

function runner(distEntry, srcEntry) {
  const dist = path.join(root, distEntry);
  if (fs.existsSync(dist)) {
    return { script: distEntry, interpreter: "node" };
  }
  return { script: srcEntry, interpreter: tsx };
}

const analytics = runner(
  "analytics/dist/sidecar.js",
  "analytics/src/sidecar.ts",
);

module.exports = {
  apps: [
    {
      name: "x-copilot-analytics",
      script: analytics.script,
      ...(analytics.interpreter ? { interpreter: analytics.interpreter } : {}),
      cwd: root,
      autorestart: true,
      max_restarts: 10,
      time: true,
      env: {
        NODE_ENV: "production",
        PORT: "8788",
      },
      out_file: path.join(root, "logs", "x-copilot-analytics.out.log"),
      error_file: path.join(root, "logs", "x-copilot-analytics.err.log"),
    },
  ],
};
