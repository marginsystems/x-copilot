/**
 * Assisted-reply routes: voice card, one suggested draft per thread, and the
 * forced-edit verify that gates a desk post (or the x.com intent fallback).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { trackAnalytics } from "./analyticsClient.js";
import { allowRate } from "./authGuard.js";
import {
  creditsExhaustedResponse,
  suggestCapMessage,
} from "./billingQuotas.js";
import {
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import { resolvePlan } from "./planResolution.js";
import { BODY_CAP_256K, readJsonBody, send } from "./httpJson.js";
import { getSessionUser } from "./sessionCookie.js";
import type { AuthUser } from "./authStore.js";
import { getXWriteCreds } from "./xIdentityStore.js";
import { xConsumerCreds } from "./xAuth.js";
import {
  MAX_REPLY_CHARS,
  buildComposeIntentUrl,
  buildIntentUrl,
  checkTrivialEdit,
  trivialEditNote,
} from "./voiceEdit.js";
import { foldLocalVoiceSources } from "./voiceLocal.js";
import {
  proposeStances,
  suggestReply,
  verifyReplyEdit,
  type ChatFn,
} from "./voiceLlm.js";
import { handlePost, voiceMode } from "./voicePostHttp.js";
import {
  resolveVoiceHandle,
  voicePayload,
} from "./voiceStatus.js";
import {
  VOICE_UNLOCK_MIN_POSTS,
  ensureVoiceProfile,
  getSuggestUsage,
  getVoiceProfile,
  removeSuggestRecord,
  reserveSuggestSlot,
  voiceUnlocked,
} from "./voiceStore.js";

/** GET /api/voice fold throttle: the fold scans every knowledge note and
 *  writes counts, so dedupe repeated mounts/midnight hydrates instead of
 *  running it on every request. Handle-less users are exempt — the fold is
 *  their only count path, and throttling it would delay the memories-first
 *  auto-learn right at the unlock bar. POST learn always folds. */
const lastLocalFoldAt = new Map<string, number>();
const LOCAL_FOLD_COOLDOWN_MS = 60_000;

function composeKindOf(body: Record<string, unknown>): "post" | "quote" | undefined {
  if (body.kind === "quote") return "quote";
  if (body.kind === "post") return "post";
  return undefined;
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
  const body = await readJsonBody(req, { maxBytes: BODY_CAP_256K });
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
  if (!allowRate(`voice-stances:${user.id}`, 20, 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many stance lookups. Slow down a moment.",
    });
    return;
  }
  const billing = ensureUserBillingRow(user.id, tenantId);
  const resolved = resolvePlan(billing, user.email);
  const planKey = resolved.planKey;
  const usage = getSuggestUsage(user.id, planKey);
  if (!usage.canSuggest) {
    send(req, res, 429, {
      error: "suggest_daily_limit",
      message: suggestCapMessage(planKey, usage.limit, resolved.reason),
      used: usage.used,
      limit: usage.limit,
      planKey,
    });
    return;
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
    mode: voiceMode(body),
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
  chat?: ChatFn,
): Promise<void> {
  if (!allowRate(`voice-suggest:${user.id}`, 20, 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many suggest calls — slow down a moment.",
    });
    return;
  }
  const body = await readJsonBody(req, { maxBytes: BODY_CAP_256K });
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
  const resolved = resolvePlan(billing, user.email);
  const planKey = resolved.planKey;
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
      message: suggestCapMessage(planKey, usage.limit, resolved.reason),
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
      message: suggestCapMessage(planKey, usage.limit, resolved.reason),
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
        ? body.stance.trim().slice(0, 140)
        : undefined,
    mode: voiceMode(body),
    composeKind: composeKindOf(body),
    chat,
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
  const body = await readJsonBody(req, { maxBytes: BODY_CAP_256K });
  if (!body) {
    send(req, res, 400, { error: "invalid_json", message: "Invalid JSON body." });
    return;
  }
  const draft = (typeof body.draft === "string" ? body.draft.trim() : "").slice(
    0,
    MAX_REPLY_CHARS,
  );
  const edited = typeof body.edited === "string" ? body.edited : "";
  const mode = voiceMode(body);
  const inReplyToId =
    typeof body.inReplyToId === "string" ? body.inReplyToId.trim() : "";
  const quoteTweetId =
    typeof body.quoteTweetId === "string" ? body.quoteTweetId.trim() : "";
  if (!draft.trim()) {
    send(req, res, 400, {
      error: "bad_request",
      message:
        mode === "compose"
          ? "Pass { draft, edited, mode: \"compose\" }."
          : "Pass { draft, edited, inReplyToId } for this thread.",
    });
    return;
  }
  if (mode === "reply" && !/^\d+$/.test(inReplyToId)) {
    send(req, res, 400, {
      error: "bad_request",
      message: "Pass { draft, edited, inReplyToId } for this thread.",
    });
    return;
  }
  if (mode === "compose" && quoteTweetId && !/^\d+$/.test(quoteTweetId)) {
    send(req, res, 400, {
      error: "bad_request",
      message: "quoteTweetId must be a numeric status id.",
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
    reason:
      result.verdict.reason ||
      (mode === "compose"
        ? "That reads like you. Post from the desk or open on X."
        : "That reads like you. Open on X when you're ready."),
    intentUrl:
      mode === "compose"
        ? buildComposeIntentUrl(edited.trim(), quoteTweetId || undefined)
        : buildIntentUrl(inReplyToId, edited.trim()),
    canPost:
      Boolean(getXWriteCreds(user.id)) && Boolean(xConsumerCreds()),
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
    await handleSuggest(req, res, user, chat);
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
