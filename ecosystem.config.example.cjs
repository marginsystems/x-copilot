// PM2 process definitions for x-copilot. Run via ./pm2-manager.sh.
//
// Setup (once per machine):
//   cp ecosystem.config.example.cjs ecosystem.config.cjs
//   ./pm2-manager.sh setup-logrotate   # optional but recommended
//   ./pm2-manager.sh start
//
// ecosystem.config.cjs is gitignored — do not commit machine-local copies.
// Secrets (X_API_BEARER_TOKEN, LLM keys) stay in .env (loaded by both the API and stats worker at startup).

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const tsx = path.join(root, "node_modules", ".bin", "tsx");

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
        // X_API_BEARER_TOKEN is loaded from .env at startup (via loadEnv).
        // If .env is missing or cwd differs, all stats fetches will fail silently.
      },
      out_file: path.join(root, "logs", "x-copilot-stats.out.log"),
      error_file: path.join(root, "logs", "x-copilot-stats.err.log"),
    },
  ],
};
