/**
 * Public X Activity webhook handler for the isolated webhook process
 * on 127.0.0.1:8789. nginx routes /api/x/activity there.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "../../server/src/http/httpJson.js";
import { xConsumerCreds } from "../../server/src/auth/xAuth.js";
import { getUserById } from "../../server/src/auth/authStore.js";
import {
  crcResponseToken,
  parsePostCreateEvent,
  parsePostDeleteEvent,
  postUrl,
  type ParsedPostCreate,
  verifyWebhookSignature,
} from "../../server/src/x-api/xActivity.js";
import {
  countOwnPostsSince,
  nextUtcDayIso,
  nextUtcMonthIso,
  rememberActivityEvent,
  removeOwnPost,
  seenActivityEvent,
  startOfUtcDayIso,
  upsertOwnPost,
} from "../../server/src/desk/ownPostStore.js";
import {
  findUserIdByXUserId,
  pauseUserSubscription,
} from "../../server/src/x-api/xActivitySubscribe.js";
import {
  creditsExhaustedResponse,
  dailyActivityUsage,
} from "../../server/src/billing/billingQuotas.js";
import { ensureUserTenant } from "../../server/src/billing/billingStore.js";
import { recordUsageEvent } from "../../server/src/billing/usageMeter.js";
import {
  markOwnReplyInteracted as markOwnReply,
  type MarkOwnReplyOpts,
  type OwnReplyMemoryOpts,
} from "../../server/src/desk/ownReplyMark.js";
import { allowRate, clientIp } from "../../server/src/auth/authGuard.js";

let testMemoryOpts: OwnReplyMemoryOpts = {};

/** Test seam so webhook notes land in an isolated knowledge root. */
export function resetWebhookMemoryProjectionForTests(
  overrides?: OwnReplyMemoryOpts,
): void {
  testMemoryOpts = { ...overrides };
}

export async function markOwnReplyInteracted(
  parsed: ParsedPostCreate,
  userId: string,
  opts?: Omit<MarkOwnReplyOpts, "publishInteracted">,
): Promise<"scout" | "organic" | "skipped"> {
  return markOwnReply(parsed, userId, {
    nowMs: opts?.nowMs,
    knowledgeRoot: opts?.knowledgeRoot ?? testMemoryOpts.knowledgeRoot,
    indexDir: opts?.indexDir ?? testMemoryOpts.indexDir,
    awaitUpsert: opts?.awaitUpsert ?? testMemoryOpts.awaitUpsert,
    upsertMemory: opts?.upsertMemory ?? testMemoryOpts.upsertMemory,
    publishInteracted: (interaction) => {
      postDeskWake({ userId, type: "interacted", interaction }).catch(() => {});
    },
  });
}

let warnedWakeForbidden = false;

export function resetDeskWakeWarningForTests(): void {
  warnedWakeForbidden = false;
}

async function wakeDesk(parsed: ParsedPostCreate, userId: string): Promise<void> {
  if (parsed.kind === "repost") return;
  await postDeskWake({
    userId,
    id: parsed.postId,
    kind: parsed.kind,
    postedAt: parsed.postedAt,
    url: postUrl(parsed.authorUsername, parsed.postId),
    text: parsed.text,
  });
}

async function postDeskWake(body: Record<string, unknown>): Promise<void> {
  try {
    const response = await fetch("http://127.0.0.1:8787/api/desk/events/wake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DESK_EVENTS_SECRET?.trim() ?? ""}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2_000),
    });
    await response.body?.cancel();
    if (response.status === 403 && !warnedWakeForbidden) {
      warnedWakeForbidden = true;
      console.warn("[xaa] desk wake soft-fail", response.status,
        "API and webhook DESK_EVENTS_SECRET values disagree or are empty.");
    } else if (!response.ok) {
      console.warn("[xaa] desk wake soft-fail", response.status);
    }
  } catch {
    console.warn("[xaa] desk wake soft-fail");
  }
}

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
  const deleted = parsePostDeleteEvent(json);
  if (deleted) {
    const deleteEventKey = `post.delete:${deleted.eventUuid}`;
    if (seenActivityEvent(deleteEventKey)) {
      send(req, res, 200, { ok: true, duplicate: true });
      return;
    }
    const userId = findUserIdByXUserId(deleted.xUserId);
    if (!userId) {
      send(req, res, 200, { ok: true, unmatched: true });
      return;
    }
    removeOwnPost({
      postId: deleted.postId,
      userId,
      xUserId: deleted.xUserId,
    });
    rememberActivityEvent(deleteEventKey);
    send(req, res, 200, { ok: true });
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
  wakeDesk(parsed, userId).catch((err) => {
    console.warn("[xaa] desk wake soft-fail", err);
  });
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
  try {
    await markOwnReplyInteracted(parsed, userId);
  } catch (err) {
    console.warn("[xaa] auto-mark soft-fail", err);
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
