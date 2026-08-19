/**
 * Standalone analytics sidecar — loopback HTTP that posts allowlisted
 * user-action events to Slack. Independent of the API process.
 *
 * GET  /health
 * POST /event   Authorization: Bearer $ANALYTICS_SECRET
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { formatSlackText, parseAnalyticsEvent } from "./analyticsEvents.js";
import { postSlackWebhook } from "./analyticsSlack.js";
import { loadEnv } from "./loadEnv.js";

const MAX_BODY_BYTES = 8_192;
const DEFAULT_PORT = 8788;
const BIND_HOST = "127.0.0.1";

export type AnalyticsServiceDeps = {
  secret?: string;
  slackWebhookUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  log?: (msg: string) => void;
};

function json(
  res: ServerResponse,
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

function peerIsLoopback(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

export function analyticsAuthorized(
  req: IncomingMessage,
  secret: string | undefined,
): boolean {
  const expected = secret?.trim() ?? "";
  if (!expected) {
    // No shared secret configured — only accept local processes, never
    // browser-initiated requests: any page loaded in a local browser is also
    // a loopback peer (simple fetch with text/plain needs no preflight).
    const isBrowser =
      req.headers.origin != null || req.headers["sec-fetch-site"] != null;
    return peerIsLoopback(req) && !isBrowser;
  }
  const auth = req.headers.authorization ?? "";
  return auth === `Bearer ${expected}`;
}

function readLimitedBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.off("data", onData);
        req.pause();
        reject(Object.assign(new Error("body_too_large"), { code: "body_too_large" }));
        return;
      }
      chunks.push(chunk);
    };
    req.on("data", onData);
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function handleAnalyticsRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: AnalyticsServiceDeps = {},
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const log = deps.log ?? ((msg) => console.log(msg));

  if (req.method === "GET" && url.pathname === "/health") {
    json(res, 200, { ok: true });
    return;
  }

  if (req.method !== "POST" || url.pathname !== "/event") {
    json(res, 404, { error: "not_found" });
    return;
  }

  if (!analyticsAuthorized(req, deps.secret)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  let rawText: string;
  try {
    rawText = await readLimitedBody(req);
  } catch (err) {
    const code = err instanceof Error ? (err as { code?: string }).code : undefined;
    if (code === "body_too_large") {
      json(res, 413, { error: "body_too_large" });
      res.on("finish", () => res.socket?.destroy());
      return;
    }
    json(res, 400, { error: "bad_request" });
    return;
  }

  let raw: unknown;
  try {
    raw = rawText ? JSON.parse(rawText) : null;
  } catch {
    json(res, 400, { error: "invalid_json" });
    return;
  }

  const parsed = parseAnalyticsEvent(raw, deps.now);
  if (!parsed.ok) {
    json(res, 400, { error: parsed.error });
    return;
  }

  const text = formatSlackText(parsed.event);
  const webhook = (deps.slackWebhookUrl ?? "").trim();
  json(res, 202, { ok: true });

  if (!webhook) {
    log(`[analytics] ${text.replaceAll("\n", " ")}`);
    return;
  }
  void postSlackWebhook(webhook, text, deps.fetchImpl ?? fetch).then((ok) => {
    if (!ok) log("[analytics] slack post failed");
  });
}

export function createAnalyticsServer(
  deps: AnalyticsServiceDeps = {},
): http.Server {
  return http.createServer((req, res) => {
    void handleAnalyticsRequest(req, res, deps).catch((err) => {
      console.error("[analytics] handler error:", err);
      if (!res.headersSent) {
        json(res, 500, { error: "internal" });
      }
    });
  });
}

export function shouldRunAnalyticsMain(
  argv1: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (
    argv1?.endsWith("analyticsService.js") ||
    argv1?.endsWith("analyticsService.ts")
  ) {
    return true;
  }
  if (env.pm_id != null && argv1?.includes("ProcessContainerFork")) {
    return true;
  }
  return false;
}

function main(): void {
  if (
    !loadEnv(resolve(process.cwd(), ".env"), {
      override: true,
      protected: ["NODE_ENV", "PORT"],
    })
  ) {
    console.warn("[analytics] .env not found — Slack webhook unset, events will only log");
  }

  if (process.env.ANALYTICS_DISABLE === "1") {
    console.log("[analytics] ANALYTICS_DISABLE=1 — not starting");
    // Idle instead of exiting: PM2 autorestart loops on a clean exit.
    setInterval(() => {}, 2 ** 31 - 1);
    return;
  }
  const port = Number(process.env.ANALYTICS_PORT || process.env.PORT || DEFAULT_PORT);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error("[analytics] invalid PORT");
    process.exit(1);
  }

  const server = createAnalyticsServer({
    secret: process.env.ANALYTICS_SECRET,
    slackWebhookUrl: process.env.SLACK_ANALYTICS_WEBHOOK_URL,
  });
  // Always loopback. A shared .env may set BIND_HOST=0.0.0.0 for the API;
  // this process must never follow that.
  server.listen(port, BIND_HOST, () => {
    console.log(`[analytics] listening on ${BIND_HOST}:${port}`);
  });
}

if (shouldRunAnalyticsMain(process.argv[1], process.env)) {
  main();
}
