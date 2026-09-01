/**
 * Public XAA webhook + authenticated watch / analytics routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "./httpJson.js";
import { getSessionUser } from "./sessionCookie.js";
import { xConsumerCreds } from "./xAuth.js";
import { getUserById } from "./authStore.js";
import {
  crcResponseToken,
  parsePostCreateEvent,
  postUrl,
  verifyWebhookSignature,
} from "./xActivity.js";
import {
  analyticsSummary,
  countOwnPostsSince,
  getWatchedThread,
  rememberActivityEvent,
  seenActivityEvent,
  startOfUtcDayIso,
  nextUtcDayIso,
  nextUtcMonthIso,
  upsertOwnPost,
  watchThread,
} from "./ownPostStore.js";
import {
  findUserIdByXUserId,
  pauseUserSubscription,
  subscribeUserToPostCreate,
} from "./xActivitySubscribe.js";
import {
  creditsExhaustedResponse,
  dailyActivityUsage,
} from "./billingQuotas.js";
import { latestAnalyticsInsight } from "./analyticsInsight.js";
import { ensureUserTenant } from "./billingStore.js";
import { recordUsageEvent } from "./usageMeter.js";
import { markInteracted } from "./interactionStore.js";
import { allowRate, clientIp } from "./authGuard.js";

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

async function handleCrc(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  if (!allowRate(`xaa-crc:${clientIp(req)}`, 5, 60_000)) {
    send(req, res, 429, { error: "rate_limited" });
    return;
  }
  const token = url.searchParams.get("crc_token")?.trim();
  const creds = xConsumerCreds();
  if (!token || !creds) {
    send(req, res, 400, { error: "crc_unavailable" });
    return;
  }
  send(req, res, 200, {
    response_token: crcResponseToken(token, creds.secret),
  });
}

async function handleActivityPost(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const creds = xConsumerCreds();
  if (!creds) {
    send(req, res, 503, { error: "xaa_unconfigured" });
    return;
  }
  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch {
    send(req, res, 413, { error: "too_large" });
    return;
  }
  const sig =
    typeof req.headers["x-twitter-webhooks-signature"] === "string"
      ? req.headers["x-twitter-webhooks-signature"]
      : undefined;
  if (!verifyWebhookSignature(raw, sig, creds.secret)) {
    send(req, res, 401, { error: "bad_signature" });
    return;
  }
  let json: unknown = {};
  try {
    json = raw.length ? JSON.parse(raw.toString("utf8")) : {};
  } catch {
    send(req, res, 400, { error: "invalid_json" });
    return;
  }
  const parsed = parsePostCreateEvent(json);
  if (!parsed) {
    send(req, res, 200, { ok: true, ignored: true });
    return;
  }
  if (seenActivityEvent(parsed.eventUuid)) {
    send(req, res, 200, { ok: true, duplicate: true });
    return;
  }
  const userId = findUserIdByXUserId(parsed.xUserId);
  if (!userId) {
    send(req, res, 200, { ok: true, unmatched: true });
    return;
  }
  const tenantId = ensureUserTenant(userId);
  const email = getUserById(userId)?.email ?? null;
  const exhausted = creditsExhaustedResponse({
    userId,
    tenantId,
    email,
  });
  if (exhausted) {
    await pauseUserSubscription(userId, nextUtcMonthIso());
    send(req, res, 200, { ok: true, paused: "credits" });
    return;
  }
  const activity = dailyActivityUsage(userId, email);
  if (!activity.can_watch) {
    await pauseUserSubscription(userId, nextUtcDayIso());
    send(req, res, 200, { ok: true, paused: "daily_cap" });
    return;
  }
  rememberActivityEvent(parsed.eventUuid, parsed.postedAt);
  upsertOwnPost({ parsed, userId, tenantId });
  recordUsageEvent({
    method: "POST",
    path: "/tweets/activity/post.create",
    status: 200,
    postsRead: 1,
    tenantId,
    meta: { postId: parsed.postId, kind: parsed.kind },
  });
  const usedToday = countOwnPostsSince(userId, startOfUtcDayIso());
  if (usedToday >= activity.limit) {
    await pauseUserSubscription(userId, nextUtcDayIso());
  }
  if (parsed.inReplyToId) {
    const watched =
      getWatchedThread(userId, parsed.inReplyToId) ??
      (parsed.conversationId
        ? getWatchedThread(userId, parsed.conversationId)
        : null);
    if (watched?.author) {
      try {
        await markInteracted({
          threadId: watched.threadId,
          author: watched.author,
          source: "discovered",
          userId,
          url: watched.url ?? undefined,
          text: watched.text ?? undefined,
          replyId: parsed.postId,
          replyUrl: postUrl(parsed.authorUsername, parsed.postId),
          postedAt: parsed.postedAt,
          conversationId:
            parsed.conversationId ?? watched.conversationId ?? undefined,
          inReplyToId: parsed.inReplyToId,
        });
      } catch (err) {
        console.warn("[xaa] auto-mark soft-fail", err);
      }
    }
  }
  send(req, res, 200, { ok: true });
}

/** Public — call before the session gate. */
export async function tryHandleXActivityWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/x/activity") return false;
  if (req.method === "GET") {
    await handleCrc(req, res, url);
    return true;
  }
  if (req.method === "POST") {
    await handleActivityPost(req, res);
    return true;
  }
  return false;
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
