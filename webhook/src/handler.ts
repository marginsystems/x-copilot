/**
 * Public X Activity webhook handler shared by the isolated webhook process
 * and the API fallback route during proxy cutover.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "../../server/src/httpJson.js";
import { xConsumerCreds } from "../../server/src/xAuth.js";
import { getUserById } from "../../server/src/authStore.js";
import {
  crcResponseToken,
  parsePostCreateEvent,
  postUrl,
  verifyWebhookSignature,
} from "../../server/src/xActivity.js";
import {
  countOwnPostsSince,
  getWatchedThread,
  nextUtcDayIso,
  nextUtcMonthIso,
  rememberActivityEvent,
  seenActivityEvent,
  startOfUtcDayIso,
  upsertOwnPost,
} from "../../server/src/ownPostStore.js";
import {
  findUserIdByXUserId,
  pauseUserSubscription,
} from "../../server/src/xActivitySubscribe.js";
import {
  creditsExhaustedResponse,
  dailyActivityUsage,
} from "../../server/src/billingQuotas.js";
import { ensureUserTenant } from "../../server/src/billingStore.js";
import { recordUsageEvent } from "../../server/src/usageMeter.js";
import { markInteracted } from "../../server/src/interactionStore.js";
import { recordDeskReplyMarked } from "../../server/src/deskBeats.js";
import { allowRate, clientIp } from "../../server/src/authGuard.js";

function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 1_048_576) {
        reject(new Error("too_large"));
        return;
      }
      chunks.push(chunk);
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
  const signature =
    typeof req.headers["x-twitter-webhooks-signature"] === "string"
      ? req.headers["x-twitter-webhooks-signature"]
      : undefined;
  if (!verifyWebhookSignature(raw, signature, creds.secret)) {
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
  const exhausted = creditsExhaustedResponse({ userId, tenantId, email });
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
      const discoveredAtMs = Date.now();
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
        try {
          recordDeskReplyMarked({
            userId,
            source: "scout",
            nowMs: discoveredAtMs,
          });
        } catch (err) {
          console.warn("[xaa] desk beats mark soft-fail", err);
        }
      } catch (err) {
        console.warn("[xaa] auto-mark soft-fail", err);
      }
    }
  }
  send(req, res, 200, { ok: true });
}

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
