/**
 * Standalone X Activity webhook process.
 *
 * GET/POST /api/x/activity
 * GET      /health
 */
import http from "node:http";
import { resolve } from "node:path";
import { loadEnv } from "../../server/src/loadEnv.js";
import { tryHandleXActivityWebhook } from "./handler.js";

const DEFAULT_PORT = 8789;
const BIND_HOST = "127.0.0.1";

function json(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createWebhookServer(): http.Server {
  return http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true });
        return;
      }
      if (await tryHandleXActivityWebhook(req, res, url)) return;
      json(res, 404, { error: "not_found" });
    })().catch((err) => {
      console.error("[webhook] handler error:", err);
      if (!res.headersSent) json(res, 500, { error: "internal" });
    });
  });
}

export function resolveWebhookPort(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return Number(env.WEBHOOK_PORT || DEFAULT_PORT);
}

export function shouldRunWebhookMain(
  argv1: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    argv1?.endsWith("/webhook/dist/sidecar.js") ||
    argv1?.endsWith("/webhook/dist/webhook/src/sidecar.js") ||
    argv1?.endsWith("/webhook/src/sidecar.ts") ||
    argv1?.endsWith("\\webhook\\dist\\sidecar.js") ||
    argv1?.endsWith("\\webhook\\dist\\webhook\\src\\sidecar.js") ||
    argv1?.endsWith("\\webhook\\src\\sidecar.ts")
  ) {
    return true;
  }
  return env.pm_id != null && argv1?.includes("ProcessContainerFork") === true;
}

function main(): void {
  if (
    !loadEnv(resolve(process.cwd(), ".env"), {
      override: true,
      protected: ["NODE_ENV", "PORT", "WEBHOOK_PORT"],
    })
  ) {
    console.warn("[webhook] .env not found — X webhook credentials unavailable");
  }
  const port = resolveWebhookPort(process.env);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error("[webhook] invalid port");
    process.exit(1);
  }
  createWebhookServer().listen(port, BIND_HOST, () => {
    console.log(`[webhook] listening on ${BIND_HOST}:${port}`);
  });
}

if (shouldRunWebhookMain(process.argv[1], process.env)) {
  main();
}
