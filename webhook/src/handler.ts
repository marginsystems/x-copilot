/**
 * Public X Activity webhook handler for the isolated webhook process
 * on 127.0.0.1:8789. nginx routes /api/x/activity there.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { send } from "../../server/src/http/httpJson.js";
import { xConsumerCreds } from "../../server/src/auth/xAuth.js";
import { getUserById } from "../../server/src/auth/authStore.js";
import {
  crcResponseToken,
  parsePostCreateEvent,
  parsePostDeleteEvent,
  postUrl,
  verifyWebhookSignature,
} from "../../server/src/x-api/xActivity.js";
import {
  countOwnPostsSince,
  getWatchedThread,
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
  listInteractionHistory,
  markInteracted,
  MAX_INTERACTION_STORE,
} from "../../server/src/desk/interactionStore.js";
import { recordDeskReplyMarked } from "../../server/src/desk/deskBeats.js";
import { recordMarkGamification } from "../../server/src/desk/gamification.js";
import { setGamificationSyncFailed } from "../../server/src/desk/interactionSync.js";
import { allowRate, clientIp } from "../../server/src/auth/authGuard.js";
import type { ParsedPostCreate } from "../../server/src/x-api/xActivity.js";
import { replyMatchesLockedScout } from "../../server/src/scout/replyMatchScout.js";
import { getScoutApproachLock } from "../../server/src/scout/scoutApproachLock.js";
import { pruneConsumedScoutThread } from "../../server/src/scout/scoutCache.js";
import {
  projectConfirmedReplyMemory,
  type ProjectConfirmedReplyMemoryInput,
} from "../../server/src/memory/interactionMemoryProjection.js";
import { buildInteractionNotePath } from "../../server/src/memory/knowledgeMemory.js";

type WebhookMemoryOpts = Pick<
  ProjectConfirmedReplyMemoryInput,
  "knowledgeRoot" | "indexDir" | "awaitUpsert" | "upsertMemory"
>;

let testMemoryOpts: WebhookMemoryOpts = {};

/** Test seam so webhook notes land in an isolated knowledge root. */
export function resetWebhookMemoryProjectionForTests(
  overrides?: WebhookMemoryOpts,
): void {
  testMemoryOpts = { ...overrides };
}

function optionalContext(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function memoryOpts(
  opts?: { nowMs?: number } & WebhookMemoryOpts,
): WebhookMemoryOpts {
  return {
    knowledgeRoot: opts?.knowledgeRoot ?? testMemoryOpts.knowledgeRoot,
    indexDir: opts?.indexDir ?? testMemoryOpts.indexDir,
    awaitUpsert: opts?.awaitUpsert ?? testMemoryOpts.awaitUpsert,
    upsertMemory: opts?.upsertMemory ?? testMemoryOpts.upsertMemory,
  };
}

async function projectWebhookReplyMemory(
  input: {
    userId: string;
    reply: string;
    threadId: string;
    author: string;
    interactedAt: string;
    url?: string;
    text?: string;
    summary?: string;
  } & WebhookMemoryOpts,
): Promise<void> {
  try {
    await projectConfirmedReplyMemory({
      userId: input.userId,
      reply: input.reply,
      threadId: input.threadId,
      author: input.author,
      interactedAt: input.interactedAt,
      source: "discovered",
      url: input.url,
      text: input.text,
      summary: input.summary,
      knowledgeRoot: input.knowledgeRoot,
      indexDir: input.indexDir,
      awaitUpsert: input.awaitUpsert,
      upsertMemory: input.upsertMemory,
    });
  } catch (err) {
    console.warn("[xaa] confirmed-reply memory soft-fail", err);
  }
}

export async function markOwnReplyInteracted(
  parsed: ParsedPostCreate,
  userId: string,
  opts?: { nowMs?: number } & WebhookMemoryOpts,
): Promise<"scout" | "organic" | "skipped"> {
  const isReply = parsed.kind === "reply" && Boolean(parsed.inReplyToId);
  if (!isReply) return "skipped";
  if (parsed.inReplyToUserId === parsed.xUserId) return "skipped";
  const targetId = parsed.inReplyToId!;
  const locked = getScoutApproachLock(userId, opts?.nowMs);
  const watched =
    getWatchedThread(userId, targetId) ??
    (parsed.conversationId
      ? getWatchedThread(userId, parsed.conversationId)
      : null);
  const matchedLock =
    !watched &&
    locked &&
    replyMatchesLockedScout(
      {
        inReplyToId: targetId,
        conversationId: parsed.conversationId,
      },
      locked,
    )
      ? locked
      : null;
  const scoutCard = watched ?? matchedLock;
  const threadId =
    watched?.threadId ??
    matchedLock?.id ??
    targetId ??
    parsed.conversationId ??
    parsed.postId;
  const author =
    scoutCard?.author ??
    (parsed.inReplyToUsername
      ? `@${parsed.inReplyToUsername.replace(/^@+/, "")}`
      : parsed.inReplyToUserId
        ? `@${parsed.inReplyToUserId}`
        : "@unknown");
  const contextUrl =
    optionalContext(scoutCard?.url) ??
    (parsed.inReplyToUsername
      ? postUrl(parsed.inReplyToUsername, targetId)
      : undefined);
  const contextText = optionalContext(scoutCard?.text);
  const history = await listInteractionHistory({
    limit: MAX_INTERACTION_STORE,
    userId,
  });
  const known = history.find((row) => row.replyId === parsed.postId) ??
    history.find(
      (row) =>
        !row.replyId &&
        (parsed.inReplyToId === row.threadId ||
          parsed.conversationId === row.threadId),
    );
  if (known) {
    const notePath = buildInteractionNotePath({
      threadId: known.threadId,
      interactedAt: known.postedAt ?? known.at,
      knowledgeRoot: memoryOpts(opts).knowledgeRoot,
    });
    let noteOwned = false;
    try {
      const note = await readFile(notePath, "utf8");
      const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(note)?.[1] ?? "";
      noteOwned =
        /(?:^|\n)userId:\s*"?([^"\n]+)"?/.exec(frontmatter)?.[1]?.trim() ===
        userId;
    } catch {
      // A missing or unreadable note needs the same repair attempt.
    }
    if (!noteOwned) {
      await projectWebhookReplyMemory({
        userId,
        reply: parsed.text,
        threadId: known.threadId,
        author: known.author || author,
        interactedAt: known.postedAt ?? known.at,
        url: contextUrl ?? known.url,
        text: contextText ?? known.text,
        summary: known.summary,
        ...memoryOpts(opts),
      });
    }
    return "skipped";
  }
  const source = scoutCard ? "scout" : "organic";
  const interaction = await markInteracted({
    threadId,
    author,
    source: "discovered",
    userId,
    url: contextUrl,
    text: contextText,
    replyId: parsed.postId,
    replyUrl: postUrl(parsed.authorUsername, parsed.postId),
    postedAt: parsed.postedAt,
    conversationId:
      parsed.conversationId ?? scoutCard?.conversationId ?? undefined,
    inReplyToId: targetId,
    nowMs: opts?.nowMs,
  });
  try {
    await pruneConsumedScoutThread(userId, [
      interaction.threadId,
      interaction.conversationId,
      interaction.inReplyToId,
    ]);
  } catch (err) {
    console.warn("[xaa] scout tank prune soft-fail", err);
  }
  recordDeskReplyMarked({
    userId,
    source,
    nowMs: opts?.nowMs,
  });
  // #656 landed on main against the old in-process handler. Keep that streak
  // increment on the sidecar so a webhook-discovered reply still counts.
  if (scoutCard) {
    try {
      await recordMarkGamification({
        threadId,
        userId,
        nowMs: opts?.nowMs ?? Date.parse(interaction.at),
      });
    } catch (err) {
      console.warn("[xaa] streak mark soft-fail", err);
      await setGamificationSyncFailed({
        threadId,
        userId,
        checkpoint: "mark",
        failed: true,
        pendingAt: interaction.at,
      }).catch(() => {});
    }
  }
  await projectWebhookReplyMemory({
    userId,
    reply: parsed.text,
    threadId: interaction.threadId,
    author: interaction.author || author,
    interactedAt: interaction.postedAt ?? interaction.at,
    url: interaction.url ?? contextUrl,
    text: contextText ?? interaction.text,
    summary: interaction.summary,
    ...memoryOpts(opts),
  });
  return source;
}

async function wakeDesk(parsed: ParsedPostCreate, userId: string): Promise<void> {
  if (parsed.kind === "repost") return;
  try {
    const response = await fetch("http://127.0.0.1:8787/api/desk/events/wake", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DESK_EVENTS_SECRET?.trim() ?? ""}`,
      },
      body: JSON.stringify({ userId, id: parsed.postId, kind: parsed.kind, postedAt: parsed.postedAt }),
      signal: AbortSignal.timeout(250),
    });
    await response.body?.cancel();
    if (!response.ok) console.warn("[xaa] desk wake soft-fail", response.status);
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
  void wakeDesk(parsed, userId);
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
