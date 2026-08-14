// PM2 process definitions for x-copilot. Run via ./pm2-manager.sh.
//
// Setup (once per machine):
//   cp ecosystem.config.example.cjs ecosystem.config.cjs
//   ./pm2-manager.sh setup-logrotate   # optional but recommended
//   ./pm2-manager.sh start
//
// ecosystem.config.cjs is gitignored — do not commit machine-local copies.
// Secrets live in .env. This file merges them into `env` so
// `pm2 restart --update-env` / delete+start actually refresh keys.
// The sidecar also loadEnv({ override: true }) as a backstop.

const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const tsx = path.join(root, "node_modules", ".bin", "tsx");

function envFromDotenv() {
  const file = path.join(root, ".env");
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let val = trimmed.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

const dotenv = envFromDotenv();

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
        ...dotenv,
        NODE_ENV: "production",
        PORT: "8787",
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
        ...dotenv,
        NODE_ENV: "production",
      },
      out_file: path.join(root, "logs", "x-copilot-stats.out.log"),
      error_file: path.join(root, "logs", "x-copilot-stats.err.log"),
    },
  ],
};
