/**
 * Assisted-reply routes: voice card, one suggested draft per thread, and the
 * forced-edit verify that gates a desk post (or the x.com intent fallback).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { trackAnalytics } from "./analyticsClient.js";
import { allowRate } from "./authGuard.js";
import {
  creditsExhaustedResponse,
  effectivePlanKey,
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import { corsHeaders } from "./cors.js";
import { getSessionUser } from "./sessionCookie.js";
import type { AuthUser } from "./authStore.js";
import { getXOauthUsername, getXWriteCreds } from "./authStore.js";
import { recordMarkGamification, getGamification } from "./gamification.js";
import {
  markInteracted,
  normalizeAuthorKey,
  parseStatusIdFromUrl,
} from "./interactionStore.js";
import { xConsumerCreds } from "./xAuth.js";
import {
  checkDeskPostLimit,
  findDeskPostByKey,
  recordDeskPost,
} from "./xPostLimits.js";
import { postUserReply } from "./xTweet.js";
import {
  MAX_REPLY_CHARS,
  buildIntentUrl,
  checkTrivialEdit,
  trivialEditNote,
} from "./voiceEdit.js";
import { postNeedsStance } from "./voiceDraft.js";
import { foldLocalVoiceSources } from "./voiceLocal.js";
import {
  proposeStances,
  suggestReply,
  verifyReplyEdit,
  type ChatFn,
  type VoiceCard,
} from "./voiceLlm.js";
import {
  VOICE_UNLOCK_MIN_POSTS,
  ensureVoiceProfile,
  getSuggestUsage,
  getVoiceProfile,
  removeSuggestRecord,
  reserveSuggestSlot,
  voiceUnlocked,
  type VoiceProfileRow,
} from "./voiceStore.js";

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 262_144) {
        resolve(null);
      } else {
        chunks.push(c);
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw) as unknown;
        resolve(
          parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : null,
        );
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

export type VoiceUiStatus =
  | "unlinked"
  | "empty"
  | "learning"
  | "insufficient"
  | "ready";

/** GET /api/voice fold throttle: the fold scans every knowledge note and
 *  writes counts, so dedupe repeated mounts/midnight hydrates instead of
 *  running it on every request. Handle-less users are exempt — the fold is
 *  their only count path, and throttling it would delay the memories-first
 *  auto-learn right at the unlock bar. POST learn always folds. */
const lastLocalFoldAt = new Map<string, number>();
const LOCAL_FOLD_COOLDOWN_MS = 60_000;

function parseCard(cardJson: string | null): VoiceCard | null {
  if (!cardJson) return null;
  try {
    return JSON.parse(cardJson) as VoiceCard;
  } catch {
    return null;
  }
}

export function resolveVoiceHandle(user: AuthUser): string | null {
  return getXOauthUsername(user.id);
}

/**
 * API fill-in only: skip the timeline when memories already unlock, or
 * when there is no handle to pull as.
 */
export function shouldPullXApi(opts: {
  postCount: number;
  handle: string | null;
}): boolean {
  return Boolean(opts.handle) && !voiceUnlocked(opts.postCount);
}

export function deriveVoiceUiStatus(
  profile: VoiceProfileRow | null,
  linkedHandle: string | null,
): VoiceUiStatus {
  if (profile?.status === "learning") return "learning";
  if (profile?.status === "ready" && profile.cardJson) return "ready";
  const posts = profile?.replyCount ?? 0;
  const hasCorpus = posts > 0 || Boolean(profile?.lastPullAt);
  if (hasCorpus && !voiceUnlocked(posts)) return "insufficient";
  if (hasCorpus) return "empty";
  if (!linkedHandle) return "unlinked";
  return "empty";
}

export function deriveNeedsLearn(_opts: {
  status: VoiceUiStatus;
  handle: string | null;
  profile: VoiceProfileRow | null;
  needsDailyUpdate: boolean;
}): boolean {
  // Ingest is onboarding + hourly only. The client must not POST learn.
  return false;
}

function voicePayload(user: AuthUser, profile: VoiceProfileRow | null) {
  const handle = resolveVoiceHandle(user);
  const tenantId = ensureUserTenant(user.id);
  const billing = ensureUserBillingRow(user.id, tenantId);
  const planKey = effectivePlanKey(billing, user.email);
  const status = deriveVoiceUiStatus(profile, handle);
  const unlocked = voiceUnlocked(profile?.replyCount ?? 0);
  const needsDailyUpdate = false;
  const needsLearn = false;
  return {
    ok: true as const,
    voice: {
      status,
      handle,
      replyCount: profile?.replyCount ?? 0,
      conversationCount: profile?.conversationCount ?? 0,
      unlockAt: VOICE_UNLOCK_MIN_POSTS,
      unlocked,
      card: parseCard(profile?.cardJson ?? null),
      cardUpdatedAt: profile?.cardUpdatedAt ?? null,
      lastPullAt: profile?.lastPullAt ?? null,
      needsDailyUpdate,
      needsLearn,
      lastError: profile?.lastError ?? null,
      suggests: getSuggestUsage(user.id, planKey),
    },
  };
}

async function handleLearn(
  req: IncomingMessage,
  res: ServerResponse,
  _user: AuthUser,
): Promise<void> {
  send(req, res, 403, {
    error: "ingest_not_user_triggered",
    message:
      "Voice updates on onboarding and the hourly ingest. Scout takeoffs are the only action that spends your credits.",
  });
}

async function handleStances(
  req: IncomingMessage,
  res: ServerResponse,
  user: AuthUser,
  chat?: ChatFn,
): Promise<void> {
  const body = await readJsonBody(req);
  if (!body) {
    send(req, res, 400, { error: "invalid_json", message: "Invalid JSON body." });
    return;
  }
  const author = (typeof body.author === "string" ? body.author.trim() : "").slice(
    0,
    100,
  );
  const text = (typeof body.text === "string" ? body.text.trim() : "").slice(
    0,
    2000,
  );
  if (!author || !text) {
    send(req, res, 400, {
      error: "bad_request",
      message: "Pass { author, text } from the thread card.",
    });
    return;
  }
  const profile = getVoiceProfile(user.id);
  if (
    !profile ||
    profile.status !== "ready" ||
    !profile.cardJson ||
    !voiceUnlocked(profile.replyCount)
  ) {
    send(req, res, 409, {
      error: "voice_not_ready",
      message: `Suggest unlocks after ${VOICE_UNLOCK_MIN_POSTS} public posts and a learned voice card.`,
    });
    return;
  }
  const tenantId = ensureUserTenant(user.id);
  const exhausted = creditsExhaustedResponse({
    userId: user.id,
    tenantId,
    email: user.email,
  });
  if (exhausted) {
    send(req, res, 402, exhausted);
    return;
  }
  const flags = Array.isArray(body.flags)
    ? body.flags
        .filter((f): f is string => typeof f === "string")
        .map((f) => f.trim())
        .filter(Boolean)
        .slice(0, 12)
    : undefined;
  const threadKind =
    typeof body.threadKind === "string"
      ? body.threadKind.trim().slice(0, 40)
      : undefined;
  if (postNeedsStance({ threadKind, flags })) {
    if (!allowRate(`voice-stances:${user.id}`, 20, 60_000)) {
      send(req, res, 429, {
        error: "rate_limited",
        message: "Too many stance lookups. Slow down a moment.",
      });
      return;
    }
    const billing = ensureUserBillingRow(user.id, tenantId);
    const planKey = effectivePlanKey(billing, user.email);
    const usage = getSuggestUsage(user.id, planKey);
    if (!usage.canSuggest) {
      send(req, res, 429, {
        error: "suggest_daily_limit",
        message: `That's ${usage.limit} suggested drafts today — the well refills at 00:00 UTC.`,
        used: usage.used,
        limit: usage.limit,
        planKey,
      });
      return;
    }
  }
  const proposed = await proposeStances({
    thread: {
      author,
      text,
      threadKind,
      flags,
      opAuthor:
        typeof body.opAuthor === "string"
          ? body.opAuthor.trim().slice(0, 100)
          : undefined,
      opText:
        typeof body.opText === "string"
          ? body.opText.trim().slice(0, 2000)
          : undefined,
    },
    chat,
  });
  if (!proposed.ok) {
    send(req, res, 502, { error: proposed.error, message: proposed.message });
    return;
  }
  send(req, res, 200, {
    ok: true,
    needed: proposed.needed,
    options: proposed.options,
    fallback: proposed.fallback,
  });
}

async function handleSuggest(
  req: IncomingMessage,
  res: ServerResponse,
  user: AuthUser,
): Promise<void> {
  if (!allowRate(`voice-suggest:${user.id}`, 20, 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many suggest calls — slow down a moment.",
    });
    return;
  }
  const body = await readJsonBody(req);
  if (!body) {
    send(req, res, 400, { error: "invalid_json", message: "Invalid JSON body." });
    return;
  }
  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  const author = (typeof body.author === "string" ? body.author.trim() : "").slice(
    0,
    100,
  );
  const text = (typeof body.text === "string" ? body.text.trim() : "").slice(
    0,
    2000,
  );
  if (!threadId || !author || !text) {
    send(req, res, 400, {
      error: "bad_request",
      message: "Pass { threadId, author, text } from the thread card.",
    });
    return;
  }

  const profile = getVoiceProfile(user.id);
  if (
    !profile ||
    profile.status !== "ready" ||
    !profile.cardJson ||
    !voiceUnlocked(profile.replyCount)
  ) {
    send(req, res, 409, {
      error: "voice_not_ready",
      message: `Suggest unlocks after ${VOICE_UNLOCK_MIN_POSTS} public posts and a learned voice card.`,
    });
    return;
  }

  const tenantId = ensureUserTenant(user.id);
  const billing = ensureUserBillingRow(user.id, tenantId);
  const planKey = effectivePlanKey(billing, user.email);
  const exhausted = creditsExhaustedResponse({
    userId: user.id,
    tenantId,
    email: user.email,
  });
  if (exhausted) {
    send(req, res, 402, exhausted);
    return;
  }
  const usage = getSuggestUsage(user.id, planKey);
  if (!usage.canSuggest) {
    send(req, res, 429, {
      error: "suggest_daily_limit",
      message: `That's ${usage.limit} suggested drafts today — the well refills at 00:00 UTC.`,
      used: usage.used,
      limit: usage.limit,
      planKey,
    });
    return;
  }

  const reservationId = reserveSuggestSlot(user.id, usage.limit, threadId);
  if (!reservationId) {
    send(req, res, 429, {
      error: "suggest_daily_limit",
      message: `That's ${usage.limit} suggested drafts today — the well refills at 00:00 UTC.`,
      used: usage.limit,
      limit: usage.limit,
      planKey,
    });
    return;
  }

  const result = await suggestReply({
    cardJson: profile.cardJson,
    thread: {
      author,
      text,
      opAuthor:
        typeof body.opAuthor === "string"
          ? body.opAuthor.trim().slice(0, 100)
          : undefined,
      opText:
        typeof body.opText === "string"
          ? body.opText.trim().slice(0, 2000)
          : undefined,
    },
    agenda:
      typeof body.agenda === "string"
        ? body.agenda.trim().slice(0, 1000)
        : undefined,
    stance:
      typeof body.stance === "string"
        ? body.stance.trim().slice(0, 80)
        : undefined,
  });
  if (!result.ok) {
    removeSuggestRecord(reservationId);
    send(req, res, 502, { error: result.error, message: result.message });
    return;
  }
  trackAnalytics({
    name: "voice.suggest",
    userId: user.id,
    email: user.email,
    handle: user.xUsername,
    detail: author,
  });
  send(req, res, 200, {
    ok: true,
    draft: result.draft,
    suggests: getSuggestUsage(user.id, planKey),
  });
}

async function handleVerify(
  req: IncomingMessage,
  res: ServerResponse,
  user: AuthUser,
): Promise<void> {
  if (!allowRate(`voice-verify:${user.id}`, 30, 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many verify calls — slow down a moment.",
    });
    return;
  }
  const body = await readJsonBody(req);
  if (!body) {
    send(req, res, 400, { error: "invalid_json", message: "Invalid JSON body." });
    return;
  }
  const draft = (typeof body.draft === "string" ? body.draft.trim() : "").slice(
    0,
    MAX_REPLY_CHARS,
  );
  const edited = typeof body.edited === "string" ? body.edited : "";
  const inReplyToId =
    typeof body.inReplyToId === "string" ? body.inReplyToId.trim() : "";
  if (!draft.trim() || !/^\d+$/.test(inReplyToId)) {
    send(req, res, 400, {
      error: "bad_request",
      message: "Pass { draft, edited, inReplyToId } for this thread.",
    });
    return;
  }

  const profile = getVoiceProfile(user.id);
  if (
    !profile ||
    profile.status !== "ready" ||
    !profile.cardJson ||
    !voiceUnlocked(profile.replyCount)
  ) {
    send(req, res, 409, {
      error: "voice_not_ready",
      message: `Verify unlocks after ${VOICE_UNLOCK_MIN_POSTS} public posts and a learned voice card.`,
    });
    return;
  }

  const tenantId = ensureUserTenant(user.id);
  const exhausted = creditsExhaustedResponse({
    userId: user.id,
    tenantId,
    email: user.email,
  });
  if (exhausted) {
    send(req, res, 402, exhausted);
    return;
  }
  if (edited.trim().length > MAX_REPLY_CHARS) {
    send(req, res, 200, {
      ok: true,
      pass: false,
      checkedBy: "local",
      reason: `X replies cap at ${MAX_REPLY_CHARS} characters — trim it a little.`,
    });
    return;
  }

  const local = checkTrivialEdit(draft, edited);
  if (local.trivial) {
    send(req, res, 200, {
      ok: true,
      pass: false,
      checkedBy: "local",
      reason: trivialEditNote(local.reason),
    });
    return;
  }

  const result = await verifyReplyEdit({ draft, edited });
  if (!result.ok) {
    send(req, res, 502, { error: result.error, message: result.message });
    return;
  }
  if (!result.verdict.ok) {
    send(req, res, 200, {
      ok: true,
      pass: false,
      checkedBy: "llm",
      reason:
        result.verdict.reason ||
        "Still reads as the draft — rework a clause or add your own take.",
    });
    return;
  }
  send(req, res, 200, {
    ok: true,
    pass: true,
    checkedBy: "llm",
    reason: result.verdict.reason || "That reads like you. Ready to post.",
    intentUrl: buildIntentUrl(inReplyToId, edited.trim()),
    canPost:
      Boolean(getXWriteCreds(user.id)) && Boolean(xConsumerCreds()),
  });
}

async function handlePost(
  req: IncomingMessage,
  res: ServerResponse,
  user: AuthUser,
  chat?: ChatFn,
): Promise<void> {
  if (!allowRate(`voice-post:${user.id}`, 20, 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many post attempts — slow down a moment.",
    });
    return;
  }
  const body = await readJsonBody(req);
  if (!body) {
    send(req, res, 400, { error: "invalid_json", message: "Invalid JSON body." });
    return;
  }
  const draft = (typeof body.draft === "string" ? body.draft.trim() : "").slice(
    0,
    MAX_REPLY_CHARS,
  );
  const edited = typeof body.edited === "string" ? body.edited : "";
  const inReplyToId =
    typeof body.inReplyToId === "string" ? body.inReplyToId.trim() : "";
  const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  const author = typeof body.author === "string" ? body.author.trim() : "";
  if (!draft.trim() || !/^\d+$/.test(inReplyToId) || !threadId || !author) {
    send(req, res, 400, {
      error: "bad_request",
      message: "Pass { draft, edited, inReplyToId, threadId, author }.",
    });
    return;
  }
  if (!normalizeAuthorKey(author)) {
    send(req, res, 400, {
      error: "bad_request",
      message: "author must be a handle.",
    });
    return;
  }
  if (edited.trim().length > MAX_REPLY_CHARS) {
    send(req, res, 400, {
      error: "too_long",
      message: `X replies cap at ${MAX_REPLY_CHARS} characters.`,
    });
    return;
  }
  // A retry after an ambiguous network failure re-sends the same client key.
  // If the first attempt actually posted (response was lost), replay that
  // result instead of posting a duplicate reply on X.
  const rawRequestKey =
    typeof body.requestKey === "string" ? body.requestKey.trim() : "";
  // Keys must fit the x_desk_posts id column: out-of-range keys are ignored
  // entirely (no replay lookup, no row id) so a retry can't PK-conflict.
  const requestKey =
    rawRequestKey.length > 0 && rawRequestKey.length <= 80 ? rawRequestKey : "";
  if (requestKey.length > 0) {
    const prior = findDeskPostByKey(user.id, requestKey);
    if (prior && prior.tweetId) {
      const handle = getXOauthUsername(user.id) || "i";
      const replyUrl = `https://x.com/${handle}/status/${prior.tweetId}`;
      const replyId = parseStatusIdFromUrl(replyUrl) ?? prior.tweetId;
      let interaction;
      try {
        interaction = await markInteracted({
          threadId,
          author,
          source: "manual",
          userId: user.id,
          url: typeof body.url === "string" ? body.url : undefined,
          text: typeof body.text === "string" ? body.text : undefined,
          summary: typeof body.summary === "string" ? body.summary : undefined,
          replyId,
          replyUrl,
          conversationId:
            typeof body.conversationId === "string"
              ? body.conversationId
              : undefined,
          inReplyToId,
        });
      } catch (err) {
        console.warn("mark after desk post replay soft-fail:", err);
      }
      const snap = await getGamification({ userId: user.id });
      const limit = checkDeskPostLimit({
        userId: user.id,
        level: snap.level,
        currentStreak: snap.currentStreak,
      });
      send(req, res, 200, {
        ok: true,
        tweet: { id: prior.tweetId, url: replyUrl },
        interaction,
        remainingToday: limit.remainingToday,
        cap: limit.cap,
      });
      return;
    }
    if (prior) {
      // The key was consumed by an ambiguous X failure: the response was
      // lost, or X accepted the post without returning an id. The reply may
      // already exist on X, so never re-issue the POST — replay the unknown
      // outcome instead of duplicating the reply.
      send(req, res, 409, {
        error: "outcome_unknown",
        message:
          "That reply may have posted — X never confirmed the id. Check your timeline before posting again.",
      });
      return;
    }
  }

  const profile = getVoiceProfile(user.id);
  if (
    !profile ||
    profile.status !== "ready" ||
    !profile.cardJson ||
    !voiceUnlocked(profile.replyCount)
  ) {
    send(req, res, 409, {
      error: "voice_not_ready",
      message: `Posting unlocks after ${VOICE_UNLOCK_MIN_POSTS} public posts and a learned voice card.`,
    });
    return;
  }
  const local = checkTrivialEdit(draft, edited);
  if (local.trivial) {
    send(req, res, 400, {
      error: "edit_required",
      message: trivialEditNote(local.reason),
    });
    return;
  }

  const write = getXWriteCreds(user.id);
  const consumer = xConsumerCreds();
  if (!write || !consumer) {
    send(req, res, 403, {
      error: "x_write_required",
      message:
        "Re-link X so the desk can post as you. The app must be Read and write in the Developer Portal.",
    });
    return;
  }

  const snap = await getGamification({ userId: user.id });
  const limit = checkDeskPostLimit({
    userId: user.id,
    level: snap.level,
    currentStreak: snap.currentStreak,
  });
  if (!limit.ok) {
    send(req, res, 429, {
      error: limit.error,
      message: limit.message,
      retryAfterSec: limit.retryAfterSec,
      remainingToday: limit.remainingToday,
      cap: limit.cap,
    });
    return;
  }

  // Re-run the forced-edit verify server-side: draft and edited are
  // client-supplied, so the local trivial-edit gate alone is bypassable.
  const verify = await verifyReplyEdit({ draft, edited, chat });
  if (!verify.ok) {
    send(req, res, 502, { error: verify.error, message: verify.message });
    return;
  }
  if (!verify.verdict.ok) {
    send(req, res, 400, {
      error: "verify_required",
      message:
        verify.verdict.reason ||
        "That still reads as the draft — rework a clause or add your own take.",
    });
    return;
  }

  const posted = await postUserReply({
    consumerKey: consumer.key,
    consumerSecret: consumer.secret,
    accessToken: write.token,
    accessTokenSecret: write.secret,
    text: edited.trim(),
    inReplyToId,
  });
  if (!posted.ok) {
    // An ambiguous failure — the fetch dropped after X may have created the
    // reply, or X accepted it without returning an id — must still consume
    // the idempotency key. Otherwise a client retry with the same key finds
    // no desk-post row and issues a duplicate POST /2/tweets.
    if (
      requestKey &&
      (posted.error === "network" || posted.error === "tweet_create_invalid")
    ) {
      try {
        recordDeskPost({
          userId: user.id,
          tweetId: "",
          inReplyToId,
          threadId,
          requestKey,
        });
      } catch (err) {
        console.warn("desk post record soft-fail:", err);
      }
    }
    send(req, res, posted.status >= 400 ? posted.status : 502, {
      error: posted.error,
      message: posted.message,
    });
    return;
  }

  trackAnalytics({
    name: "desk.post",
    userId: user.id,
    email: user.email,
    handle: user.xUsername,
    detail: author,
  });
  const handle = getXOauthUsername(user.id) || "i";
  const replyUrl = `https://x.com/${handle}/status/${posted.tweetId}`;
  const replyId = parseStatusIdFromUrl(replyUrl) ?? posted.tweetId;
  try {
    recordDeskPost({
      userId: user.id,
      tweetId: posted.tweetId,
      inReplyToId,
      threadId,
      requestKey: requestKey || undefined,
    });
  } catch (err) {
    console.warn("desk post record soft-fail:", err);
  }

  const conversationId =
    typeof body.conversationId === "string" ? body.conversationId : undefined;
  let interaction;
  try {
    interaction = await markInteracted({
      threadId,
      author,
      source: "manual",
      userId: user.id,
      url: typeof body.url === "string" ? body.url : undefined,
      text: typeof body.text === "string" ? body.text : undefined,
      summary: typeof body.summary === "string" ? body.summary : undefined,
      replyId,
      replyUrl,
      conversationId,
      inReplyToId,
    });
  } catch (err) {
    console.warn("mark after desk post soft-fail:", err);
  }
  let gamification;
  if (interaction) {
    try {
      gamification = await recordMarkGamification({
        threadId,
        userId: user.id,
        nowMs: Date.parse(interaction.at) || Date.now(),
      });
    } catch (err) {
      console.warn("gamification mark after desk post soft-fail:", err);
    }
  }

  send(req, res, 200, {
    ok: true,
    tweet: { id: posted.tweetId, url: replyUrl },
    interaction,
    remainingToday: Math.max(0, limit.remainingToday - 1),
    cap: limit.cap,
    ...(gamification ? { gamification } : {}),
  });
}

export async function tryHandleVoice(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  chat?: ChatFn,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/voice")) return false;

  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, {
      error: "unauthenticated",
      message: "Sign in required",
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/voice") {
    const tenantId = ensureUserTenant(user.id);
    ensureVoiceProfile(user.id, tenantId);
    // Local memories first — cheap, and often enough to unlock. Throttle the
    // full note scan so bursts (mount + per-tab midnight hydrates) fold once
    // per window instead of once per GET. Learn always folds.
    const now = Date.now();
    const handle = resolveVoiceHandle(user);
    // Handle-less users have no X pull to advance their count — the GET fold
    // is their only path, so never throttle it away (a throttled reload right
    // after marking the unlock-bar memory would suppress the silent learn).
    if (
      !handle ||
      (lastLocalFoldAt.get(user.id) ?? 0) <= now - LOCAL_FOLD_COOLDOWN_MS
    ) {
      lastLocalFoldAt.set(user.id, now);
      await foldLocalVoiceSources(user.id);
    }
    const profile = getVoiceProfile(user.id);
    send(req, res, 200, voicePayload(user, profile));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/learn") {
    await handleLearn(req, res, user);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/stances") {
    await handleStances(req, res, user, chat);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/suggest") {
    await handleSuggest(req, res, user);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/verify") {
    await handleVerify(req, res, user);
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/post") {
    await handlePost(req, res, user, chat);
    return true;
  }

  send(req, res, 404, { error: "not_found" });
  return true;
}
