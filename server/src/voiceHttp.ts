/**
 * Assisted-reply routes: voice card, one suggested draft per thread, and the
 * forced-edit verify that gates the x.com intent URL. Human posts on X;
 * we never POST /2/tweets.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { allowRate } from "./authGuard.js";
import {
  creditsExhaustedResponse,
  effectivePlanKey,
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import { corsHeaders } from "./cors.js";
import { startOfUtcDayIso } from "./ownPostStore.js";
import { getSessionUser } from "./sessionCookie.js";
import type { AuthUser } from "./authStore.js";
import { parseXHandle } from "./xHandle.js";
import {
  MAX_REPLY_CHARS,
  buildIntentUrl,
  checkTrivialEdit,
  trivialEditNote,
} from "./voiceEdit.js";
import { pullOwnReplies, resolveXUser } from "./voiceIngest.js";
import {
  generateVoiceCard,
  suggestReply,
  verifyReplyEdit,
  type VoiceCard,
} from "./voiceLlm.js";
import {
  VOICE_UNLOCK_MIN_CONVERSATIONS,
  ensureVoiceProfile,
  foldDeskReplies,
  getSuggestUsage,
  getVoiceProfile,
  listVoiceReplies,
  recordSuggest,
  refreshVoiceCounts,
  saveVoiceCard,
  setVoiceProfileStatus,
  updateVoiceProfilePull,
  upsertVoiceReplies,
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
        req.destroy();
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

function parseCard(cardJson: string | null): VoiceCard | null {
  if (!cardJson) return null;
  try {
    return JSON.parse(cardJson) as VoiceCard;
  } catch {
    return null;
  }
}

export function deriveVoiceUiStatus(
  profile: VoiceProfileRow | null,
  linkedHandle: string | null,
): VoiceUiStatus {
  if (!linkedHandle) return "unlinked";
  if (!profile) return "empty";
  if (profile.status === "learning") return "learning";
  if (profile.status === "ready" && profile.cardJson) return "ready";
  if (profile.lastPullAt) return "insufficient";
  return "empty";
}

function voicePayload(user: AuthUser, profile: VoiceProfileRow | null) {
  const handle = parseXHandle(user.xUsername ?? "");
  const tenantId = ensureUserTenant(user.id);
  const billing = ensureUserBillingRow(user.id, tenantId);
  const planKey = effectivePlanKey(billing, user.email);
  const status = deriveVoiceUiStatus(profile, handle);
  const unlocked = voiceUnlocked(profile?.conversationCount ?? 0);
  const needsDailyUpdate = Boolean(
    handle &&
      profile?.lastPullAt &&
      profile.lastPullAt < startOfUtcDayIso() &&
      profile.status !== "learning",
  );
  return {
    ok: true as const,
    voice: {
      status,
      handle,
      replyCount: profile?.replyCount ?? 0,
      conversationCount: profile?.conversationCount ?? 0,
      unlockAt: VOICE_UNLOCK_MIN_CONVERSATIONS,
      unlocked,
      card: parseCard(profile?.cardJson ?? null),
      cardUpdatedAt: profile?.cardUpdatedAt ?? null,
      lastPullAt: profile?.lastPullAt ?? null,
      needsDailyUpdate,
      lastError: profile?.lastError ?? null,
      suggests: getSuggestUsage(user.id, planKey),
    },
  };
}

async function handleLearn(
  req: IncomingMessage,
  res: ServerResponse,
  user: AuthUser,
): Promise<void> {
  if (!allowRate(`voice-learn:${user.id}`, 6, 10 * 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Voice learn is rate limited — try again in a few minutes.",
    });
    return;
  }
  const handle = parseXHandle(user.xUsername ?? "");
  if (!handle) {
    send(req, res, 400, {
      error: "x_not_linked",
      message: "Link your X account first — voice learns from your public replies.",
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

  const profile = ensureVoiceProfile(user.id, tenantId);
  const priorStatus = profile.status;
  setVoiceProfileStatus(user.id, "learning");

  const finishWithError = (
    status: number,
    error: string,
    message: string,
  ): void => {
    setVoiceProfileStatus(
      user.id,
      priorStatus === "ready" ? "ready" : "empty",
      message,
    );
    send(req, res, status, { error, message });
  };

  const resolved = await resolveXUser(handle);
  if (!resolved.ok) {
    finishWithError(
      resolved.status >= 400 && resolved.status < 600 ? resolved.status : 502,
      resolved.error,
      resolved.message,
    );
    return;
  }
  if (resolved.protected) {
    finishWithError(
      409,
      "account_protected",
      `@${handle} is protected. Voice only reads public replies — there is no workaround, and we will not scrape.`,
    );
    return;
  }

  const pull = await pullOwnReplies({
    xUserId: resolved.id,
    sinceId: profile.sinceId,
  });
  if (!pull.ok) {
    finishWithError(
      pull.status >= 400 && pull.status < 600 ? pull.status : 502,
      pull.error,
      pull.message,
    );
    return;
  }

  upsertVoiceReplies(user.id, pull.replies);
  foldDeskReplies(user.id);
  updateVoiceProfilePull({
    userId: user.id,
    xUsername: resolved.username,
    xUserId: resolved.id,
    sinceId: pull.newestId,
  });

  let updated = getVoiceProfile(user.id);
  if (updated && voiceUnlocked(updated.conversationCount)) {
    const cardResult = await generateVoiceCard({
      handle: resolved.username,
      replies: listVoiceReplies(user.id, 120),
    });
    if (!cardResult.ok) {
      finishWithError(502, cardResult.error, cardResult.message);
      return;
    }
    saveVoiceCard({
      userId: user.id,
      cardJson: cardResult.cardJson,
      model: cardResult.model,
    });
  } else {
    // Below the unlock bar — keep an existing card if one was already earned.
    setVoiceProfileStatus(user.id, priorStatus === "ready" ? "ready" : "empty");
  }

  updated = getVoiceProfile(user.id);
  send(req, res, 200, voicePayload(user, updated));
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
  const author = typeof body.author === "string" ? body.author.trim() : "";
  const text = typeof body.text === "string" ? body.text.trim() : "";
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
    !voiceUnlocked(profile.conversationCount)
  ) {
    send(req, res, 409, {
      error: "voice_not_ready",
      message: `Suggest unlocks after ${VOICE_UNLOCK_MIN_CONVERSATIONS} reply conversations and a learned voice card.`,
    });
    return;
  }

  const tenantId = ensureUserTenant(user.id);
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

  const result = await suggestReply({
    cardJson: profile.cardJson,
    thread: {
      author,
      text,
      opAuthor: typeof body.opAuthor === "string" ? body.opAuthor : undefined,
      opText: typeof body.opText === "string" ? body.opText : undefined,
    },
    agenda: typeof body.agenda === "string" ? body.agenda : undefined,
  });
  if (!result.ok) {
    send(req, res, 502, { error: result.error, message: result.message });
    return;
  }
  recordSuggest(user.id, threadId);
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
  const draft = typeof body.draft === "string" ? body.draft : "";
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
  });
}

export async function tryHandleVoice(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
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
    let profile = getVoiceProfile(user.id);
    if (profile) {
      // Desk-detected replies fold in for free; API pulls stay explicit.
      foldDeskReplies(user.id);
      refreshVoiceCounts(user.id);
      profile = getVoiceProfile(user.id);
    } else {
      profile = ensureVoiceProfile(user.id, tenantId);
    }
    send(req, res, 200, voicePayload(user, profile));
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/voice/learn") {
    await handleLearn(req, res, user);
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

  send(req, res, 404, { error: "not_found" });
  return true;
}
