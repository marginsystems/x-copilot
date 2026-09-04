/**
 * Desk POST /api/voice/post — X write, idempotency, and mark-after-post.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { trackAnalytics } from "./analyticsClient.js";
import { allowRate } from "./authGuard.js";
import type { AuthUser } from "./authStore.js";
import {
  recordDeskOriginalPosted,
  recordDeskReplyMarked,
} from "./deskBeats.js";
import { getSuggestion, markSuggestion } from "./forYouStore.js";
import { recordMarkGamification, getGamification } from "./gamification.js";
import { BODY_CAP_256K, readJsonBody, send } from "./httpJson.js";
import {
  normalizeAuthorKey,
  parseStatusIdFromUrl,
} from "./interactionCooldown.js";
import { markInteracted } from "./interactionStore.js";
import {
  MAX_REPLY_CHARS,
  checkTrivialEdit,
  trivialEditNote,
} from "./voiceEdit.js";
import { verifyReplyEdit, type ChatFn } from "./voiceLlm.js";
import {
  VOICE_UNLOCK_MIN_POSTS,
  getVoiceProfile,
  voiceUnlocked,
} from "./voiceStore.js";
import { xConsumerCreds } from "./xAuth.js";
import { getXOauthUsername, getXWriteCreds } from "./xIdentityStore.js";
import {
  checkDeskPostLimit,
  findDeskPostByKey,
  recordDeskPost,
} from "./xPostLimits.js";
import { postUserReply, postUserTweet } from "./xTweet.js";

export function voiceMode(body: Record<string, unknown>): "reply" | "compose" {
  return body.mode === "compose" ? "compose" : "reply";
}

export async function handlePost(
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
  const clientReplyId =
    typeof body.inReplyToId === "string" ? body.inReplyToId.trim() : "";
  let inReplyToId = clientReplyId;
  let quoteTweetId = "";
  let threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
  let author = typeof body.author === "string" ? body.author.trim() : "";
  let suggestionId =
    typeof body.suggestionId === "string" ? body.suggestionId.trim() : "";

  // A retry after an ambiguous network failure re-sends the same client key.
  // If the first attempt actually posted (response was lost), replay that
  // result instead of posting a duplicate reply on X. This lookup must run
  // before the compose suggestion gate: a successful desk post flips the row
  // to done, so a retry would otherwise hit the 404 below instead of the
  // replay result.
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
      if (mode === "compose") {
        try {
          markSuggestion({
            id: suggestionId,
            userId: user.id,
            status: "done",
            postedTweetId: prior.tweetId,
          });
        } catch (err) {
          console.warn("mark For You after desk post replay soft-fail:", err);
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
          remainingToday: limit.remainingToday,
          cap: limit.cap,
        });
        return;
      }
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

  if (mode === "compose") {
    if (!draft.trim() || !suggestionId) {
      send(req, res, 400, {
        error: "bad_request",
        message: 'Pass { draft, edited, mode: "compose", suggestionId }.',
      });
      return;
    }
    if (/^\d+$/.test(clientReplyId)) {
      send(req, res, 400, {
        error: "reply_forbidden",
        message:
          "For You compose posts cannot reply to another tweet. Open on X for Scout replies.",
      });
      return;
    }
    const suggestion = getSuggestion(suggestionId, user.id);
    if (
      !suggestion ||
      suggestion.status !== "suggested" ||
      Date.parse(suggestion.expiresAt) <= Date.now()
    ) {
      send(req, res, 404, {
        error: "not_found",
        message: "Suggestion is gone or already acted on.",
      });
      return;
    }
    if (suggestion.kind !== "post" && suggestion.kind !== "quote") {
      send(req, res, 400, {
        error: "compose_kind",
        message: "Only For You post and quote cards can post from the desk.",
      });
      return;
    }
    if (suggestion.kind === "quote") {
      if (!suggestion.targetId || !/^\d+$/.test(suggestion.targetId)) {
        send(req, res, 400, {
          error: "bad_quote",
          message: "This quote card has no numeric target to quote.",
        });
        return;
      }
      quoteTweetId = suggestion.targetId;
    }
    // Client-supplied draft/edited can dodge the trivial-edit gate below, so
    // also compare the posted text against the stored digest draft and reject
    // a verbatim (or trivial) reuse before POST /2/tweets.
    if (suggestion.draft && checkTrivialEdit(suggestion.draft, edited).trivial) {
      send(req, res, 400, {
        error: "edit_required",
        message:
          "That's still the digest draft — rework a clause or add your own take.",
      });
      return;
    }
    threadId = suggestion.id;
    author = getXOauthUsername(user.id) || "you";
  } else {
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
  }
  if (edited.trim().length > MAX_REPLY_CHARS) {
    send(req, res, 400, {
      error: "too_long",
      message: `X replies cap at ${MAX_REPLY_CHARS} characters.`,
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

  const posted =
    mode === "compose"
      ? await postUserTweet({
          consumerKey: consumer.key,
          consumerSecret: consumer.secret,
          accessToken: write.token,
          accessTokenSecret: write.secret,
          text: edited.trim(),
          quoteTweetId: quoteTweetId || undefined,
        })
      : await postUserReply({
          consumerKey: consumer.key,
          consumerSecret: consumer.secret,
          accessToken: write.token,
          accessTokenSecret: write.secret,
          text: edited.trim(),
          inReplyToId,
        });
  const relatedId = mode === "compose" ? quoteTweetId : inReplyToId;
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
          inReplyToId: relatedId,
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
    detail: mode === "compose" ? suggestionId : author,
  });
  const handle = getXOauthUsername(user.id) || "i";
  const replyUrl = `https://x.com/${handle}/status/${posted.tweetId}`;
  const replyId = parseStatusIdFromUrl(replyUrl) ?? posted.tweetId;
  try {
    recordDeskPost({
      userId: user.id,
      tweetId: posted.tweetId,
      inReplyToId: relatedId,
      threadId,
      requestKey: requestKey || undefined,
    });
  } catch (err) {
    console.warn("desk post record soft-fail:", err);
  }

  if (mode === "compose") {
    const isOriginal = getSuggestion(suggestionId, user.id)?.kind === "post";
    try {
      markSuggestion({
        id: suggestionId,
        userId: user.id,
        status: "done",
        postedTweetId: posted.tweetId,
      });
    } catch (err) {
      console.warn("mark For You after desk post soft-fail:", err);
    }
    if (isOriginal) {
      try {
        recordDeskOriginalPosted({ userId: user.id });
      } catch (err) {
        console.warn("desk beats original soft-fail:", err);
      }
    }
    send(req, res, 200, {
      ok: true,
      tweet: { id: posted.tweetId, url: replyUrl },
      remainingToday: Math.max(0, limit.remainingToday - 1),
      cap: limit.cap,
    });
    return;
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
  if (interaction) {
    try {
      recordDeskReplyMarked({
        userId: user.id,
        source: "scout",
        nowMs: Date.parse(interaction.at) || Date.now(),
      });
    } catch (err) {
      console.warn("desk beats mark after desk post soft-fail:", err);
    }
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
