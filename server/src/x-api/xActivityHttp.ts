/**
 * Authenticated watch / analytics routes. The public XAA webhook lives on
 * the isolated webhook process (127.0.0.1:8789), not this API.
 */
import { objectValue } from "../platform/unknownValue.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "../http/httpJson.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import {
  analyticsSummary,
  watchThread,
} from "../desk/ownPostStore.js";
import { subscribeUserToPostCreate } from "./xActivitySubscribe.js";
import { dailyActivityUsage } from "../billing/billingQuotas.js";
import { latestAnalyticsInsight } from "../desk/analyticsInsight.js";
import { allowRate } from "../auth/authGuard.js";
import { retainScoutContextForTarget } from "../scout/scoutEvidenceContext.js";
import { getLastScout, type LastScoutSnapshot } from "../scout/scoutCache.js";

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
        ? objectValue(JSON.parse(raw.toString("utf8")))
        : {};
    } catch {
      send(req, res, 400, { error: "invalid_json" });
      return true;
    }
    const batch = Array.isArray(body.threads) ? body.threads : [body];
    let scoutSnapshot: LastScoutSnapshot | null = null;
    try {
      scoutSnapshot = await getLastScout({ userId: user.id });
    } catch (err) {
      console.warn("watch context tank read soft-fail:", err);
    }
    let n = 0;
    for (const item of batch.slice(0, 40)) {
      if (!item || typeof item !== "object") continue;
      const row = objectValue(item);
      const threadId = String(row.threadId ?? "").trim();
      if (!threadId) continue;
      const author = typeof row.author === "string" ? row.author : undefined;
      const url = typeof row.url === "string" ? row.url : undefined;
      const text = typeof row.text === "string" ? row.text : undefined;
      const conversationId =
        typeof row.conversationId === "string" ? row.conversationId : undefined;
      watchThread({
        userId: user.id,
        threadId,
        author,
        url,
        text,
        conversationId,
      });
      try {
        await retainScoutContextForTarget({
          userId: user.id,
          targetId: threadId,
          conversationId,
          fallbackAuthor: author,
          fallbackText: text,
          source: "watch",
          snapshot: scoutSnapshot,
        });
      } catch (err) {
        console.warn("watch context retain soft-fail:", err);
      }
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
