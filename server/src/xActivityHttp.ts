/**
 * Public XAA webhook + authenticated watch / analytics routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "./httpJson.js";
import { getSessionUser } from "./sessionCookie.js";
import {
  analyticsSummary,
  watchThread,
} from "./ownPostStore.js";
import { subscribeUserToPostCreate } from "./xActivitySubscribe.js";
import { dailyActivityUsage } from "./billingQuotas.js";
import { latestAnalyticsInsight } from "./analyticsInsight.js";
import { allowRate } from "./authGuard.js";

type XActivityWebhookHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => Promise<boolean>;

export async function tryHandleXActivityWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/x/activity") {
    return false;
  }
  const handlerPath = import.meta.url.endsWith(".ts")
    ? "../../webhook/src/handler.ts"
    : "../../webhook/dist/webhook/src/handler.js";
  let handleWebhook: XActivityWebhookHandler;
  try {
    ({ tryHandleXActivityWebhook: handleWebhook } = (await import(
      handlerPath
    )) as { tryHandleXActivityWebhook: XActivityWebhookHandler });
  } catch {
    send(req, res, 503, { error: "webhook_unavailable" });
    return true;
  }
  return handleWebhook(req, res, url);
}

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 1_048_576) {
        reject(new Error("too_large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export async function tryHandleXActivityAuthed(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/watch") {
    const user = getSessionUser(req);
    if (!user) {
      send(req, res, 401, { error: "unauthenticated" });
      return true;
    }
    if (!allowRate(`watch:${user.id}`, 40, 60_000)) {
      send(req, res, 429, { error: "rate_limited" });
      return true;
    }
    let raw: Buffer;
    try {
      raw = await readRawBody(req);
    } catch {
      send(req, res, 413, { error: "too_large" });
      return true;
    }
    let body: Record<string, unknown> = {};
    try {
      body = raw.length
        ? (JSON.parse(raw.toString("utf8")) as Record<string, unknown>)
        : {};
    } catch {
      send(req, res, 400, { error: "invalid_json" });
      return true;
    }
    const batch = Array.isArray(body.threads) ? body.threads : [body];
    let n = 0;
    for (const item of batch.slice(0, 40)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const threadId = String(row.threadId ?? "").trim();
      if (!threadId) continue;
      watchThread({
        userId: user.id,
        threadId,
        author: typeof row.author === "string" ? row.author : undefined,
        url: typeof row.url === "string" ? row.url : undefined,
        text: typeof row.text === "string" ? row.text : undefined,
        conversationId:
          typeof row.conversationId === "string"
            ? row.conversationId
            : undefined,
      });
      n += 1;
    }
    if (!n) {
      send(req, res, 400, { error: "thread_id_required" });
      return true;
    }
    send(req, res, 200, { ok: true, watched: n });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/activity/subscribe") {
    const user = getSessionUser(req);
    if (!user) {
      send(req, res, 401, { error: "unauthenticated" });
      return true;
    }
    if (!allowRate(`xaa-sub:${user.id}`, 6, 10 * 60_000)) {
      send(req, res, 429, { error: "rate_limited" });
      return true;
    }
    const result = await subscribeUserToPostCreate(user.id);
    send(req, res, result.ok ? 200 : 502, result);
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/analytics") {
    const user = getSessionUser(req);
    if (!user) {
      send(req, res, 401, { error: "unauthenticated" });
      return true;
    }
    if (!allowRate(`analytics:${user.id}`, 60, 60_000)) {
      send(req, res, 429, { error: "rate_limited" });
      return true;
    }
    const activity = dailyActivityUsage(user.id, user.email);
    send(req, res, 200, {
      ok: true,
      activity,
      insight: latestAnalyticsInsight(user.id),
      ...analyticsSummary(user.id),
    });
    return true;
  }
  return false;
}
