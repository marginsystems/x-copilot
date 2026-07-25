/**
 * Local sidecar — holds X session cookies + DeepSeek calls off the browser.
 * Stream 1: health + stubs for /api/search and /api/draft.
 */
import http from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

loadEnv(resolve(process.cwd(), ".env"));

const PORT = Number(process.env.PORT || 8787);

function loadEnv(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
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
    if (!(key in process.env)) process.env[key] = val;
  }
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(json);
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    return send(res, 204, {});
  }

  if (req.method === "GET" && (url.pathname === "/api/health" || url.pathname === "/health")) {
    const hasSession = Boolean(process.env.X_AUTH_TOKEN && process.env.X_CT0);
    const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY);
    return send(res, 200, {
      ok: true,
      sessionConfigured: hasSession,
      deepseekConfigured: hasDeepseek,
      note: "Search/draft clients land in stream 1 — stubs return 501 for now.",
    });
  }

  if (req.method === "POST" && url.pathname === "/api/search") {
    await readBody(req).catch(() => ({}));
    return send(res, 501, {
      error: "not_implemented",
      message: "Wire session-backed X search here (For You / query).",
    });
  }

  if (req.method === "POST" && url.pathname === "/api/draft") {
    await readBody(req).catch(() => ({}));
    return send(res, 501, {
      error: "not_implemented",
      message: "Wire DeepSeek draft generation here.",
    });
  }

  send(res, 404, { error: "not_found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`x-copilot sidecar on http://127.0.0.1:${PORT}`);
});
