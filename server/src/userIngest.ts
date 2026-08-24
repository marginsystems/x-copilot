/**
 * Platform-paced ingest: one initial pull when we first get the user's X,
 * then hourly incremental updates. Does not debit Scout credits.
 */
import type { AuthUser } from "./authStore.js";
import {
  getUserById,
  listIngestUsers,
  setUserXUsername,
} from "./authStore.js";
import {
  getXOauthUsername,
  getXOauthXUserId,
} from "./xIdentityStore.js";
import { dailyActivityUsage } from "./billingQuotas.js";
import { ensureUserTenant } from "./billingStore.js";
import {
  countOwnPostsSince,
  startOfUtcDayIso,
  upsertOwnPost,
} from "./ownPostStore.js";
import { foldLocalVoiceSources } from "./voiceLocal.js";
import { generateVoiceCard } from "./voiceLlm.js";
import {
  pullOwnReplies,
  resolveXUser,
  VOICE_TARGET_POSTS,
  type XApiGetFn,
} from "./voiceIngest.js";
import {
  ensureVoiceProfile,
  getVoiceProfile,
  listVoiceReplies,
  nowIso,
  resetUserVoiceCorpus,
  saveVoiceCard,
  setVoiceProfileStatus,
  stampVoiceCardAttempt,
  updateVoiceProfilePull,
  upsertVoiceReplies,
  voiceCardStale,
  voiceUnlocked,
  type VoiceReplyInput,
} from "./voiceStore.js";
import { xApiGet } from "./xApi.js";
import type { ParsedPostCreate } from "./xActivity.js";
import { allowRate } from "./authGuard.js";

/** Shared cap so Google signups cannot spray initial timeline pulls. */
export const CORPUS_INGEST_RATE = { max: 6, windowMs: 10 * 60 * 1000 };

export type IngestMode = "initial" | "hourly";

export type UserIngestResult = {
  ok: boolean;
  userId: string;
  conversationCount: number;
  unlocked: boolean;
  pulled: number;
  ownPostsIngested: number;
  error?: string;
  message?: string;
};

/** App-bearer reads that the hourly/onboarding path controls — not Scout credits. */
const ingestGet: XApiGetFn = (opts) => xApiGet({ ...opts, skipUsage: true });

export function resolveIngestHandle(user: AuthUser): string | null {
  return getXOauthUsername(user.id);
}

export type BeginVoiceCorpusReason = "x_oauth" | "onboarding" | "x_username";

/**
 * Single kickoff when we have the user's X: initial corpus pull + live
 * subscribe. Official X OAuth is the preferred trigger (harder to fake than
 * a typed handle). Soft-fails so login / setup still complete.
 *
 * For `x_oauth` the linked account is the source of truth: it wins over a
 * typed handle, and a linked account that differs from the stored corpus is
 * re-pulled (corpus reset + subscription repoint) instead of skipped. The
 * subscribe always runs — the old code subscribed on every X login and every
 * onboarding regardless of whether the pull was skipped.
 */
export async function beginVoiceCorpus(opts: {
  user: AuthUser;
  reason: BeginVoiceCorpusReason;
  force?: boolean;
  deps?: {
    ingest?: typeof runUserIngest;
    subscribe?: (userId: string) => Promise<unknown>;
    allow?: typeof allowRate;
  };
}): Promise<UserIngestResult | null> {
  const oauthXUserId =
    opts.reason === "x_oauth" ? getXOauthXUserId(opts.user.id) : null;
  const handle = resolveIngestHandle(opts.user);
  if (!handle) return null;
  const profile = getVoiceProfile(opts.user.id);
  const alreadyIngested = Boolean(profile?.sinceId);
  const repoint =
    oauthXUserId != null &&
    profile?.xUserId != null &&
    oauthXUserId !== profile.xUserId;
  const allow = opts.deps?.allow ?? allowRate;
  const ingest = opts.deps?.ingest ?? runUserIngest;
  let result: UserIngestResult | null = null;
  if (alreadyIngested && !opts.force && !repoint) {
    // Already filled and the identity is unchanged — nothing new to pull.
  } else {
    if (
      !allow(
        `corpus-ingest:${opts.user.id}`,
        CORPUS_INGEST_RATE.max,
        CORPUS_INGEST_RATE.windowMs,
      )
    ) {
      console.warn(`[corpus] ingest rate-limited (${opts.reason})`);
    } else {
      if (repoint) {
        // The linked account differs from the corpus account: start the
        // corpus fresh for the linked identity and drop the old account's
        // live subscription so the re-subscribe below targets the new one.
        resetUserVoiceCorpus(opts.user.id, profile?.xUserId);
        // Point the public handle at the newly linked account only once the
        // repoint runs; stamping it at OAuth time lets a rate-limited ingest
        // leave x_username on the new account while the corpus and live
        // subscription still track the old one.
        setUserXUsername(opts.user.id, handle);
        try {
          const { removeUserPostCreateSubscription } = await import(
            "./xActivitySubscribe.js"
          );
          const removed = await removeUserPostCreateSubscription(opts.user.id);
          if (!removed.ok) {
            console.warn(
              "[xaa] repoint: could not delete the old account's post.create subscription; the new account is not subscribed yet",
            );
          }
        } catch (err) {
          console.warn("[xaa] repoint remove subscription", err);
        }
      }
      try {
        result = await ingest({ user: opts.user, mode: "initial", handle });
      } catch (err) {
        console.warn(`[corpus] ingest soft-fail (${opts.reason})`, err);
      }
    }
  }
  try {
    if (opts.deps?.subscribe) {
      await opts.deps.subscribe(opts.user.id);
    } else {
      const { subscribeUserToPostCreate } = await import(
        "./xActivitySubscribe.js"
      );
      await subscribeUserToPostCreate(
        opts.user.id,
        oauthXUserId ? { xUserId: oauthXUserId } : undefined,
      );
    }
  } catch (err) {
    console.warn("[xaa] subscribe", err);
  }
  return result;
}

function replyToOwnPost(
  reply: VoiceReplyInput,
  opts: { xUserId: string; handle: string },
): ParsedPostCreate {
  return {
    eventUuid: `ingest:${reply.id}`,
    xUserId: opts.xUserId,
    postId: reply.id,
    kind: reply.inReplyToId ? "reply" : "original",
    text: reply.text,
    postedAt: reply.postedAt ?? nowIso(),
    inReplyToId: reply.inReplyToId ?? null,
    inReplyToUserId: null,
    conversationId: reply.conversationId ?? null,
    authorUsername: opts.handle,
    metrics: {},
  };
}

function foldRepliesIntoOwnPosts(opts: {
  userId: string;
  replies: VoiceReplyInput[];
  xUserId: string;
  handle: string;
}): number {
  const user = getUserById(opts.userId);
  const activity = dailyActivityUsage(opts.userId, user?.email ?? null);
  if (!activity.can_watch) {
    console.warn(
      `[ingest] own_posts fold suppressed userId=${opts.userId}: daily activity watch cap reached (${activity.used}/${activity.limit})`,
    );
    return 0;
  }
  const tenantId = ensureUserTenant(opts.userId);
  let n = 0;
  for (const reply of opts.replies) {
    if (!reply.id.trim()) continue;
    if (countOwnPostsSince(opts.userId, startOfUtcDayIso()) >= activity.limit) {
      console.warn(
        `[ingest] own_posts fold stopped at daily activity cap userId=${opts.userId} limit=${activity.limit}`,
      );
      break;
    }
    const isNew = upsertOwnPost({
      parsed: replyToOwnPost(reply, {
        xUserId: opts.xUserId,
        handle: opts.handle,
      }),
      userId: opts.userId,
      tenantId,
    });
    if (isNew) n += 1;
  }
  return n;
}

/**
 * Memories first, then one official timeline page. `initial` aims at
 * 100 public posts. `hourly` only reads since the stored cursor.
 * Never bills the user pool.
 */
export async function runUserIngest(opts: {
  user: AuthUser;
  mode: IngestMode;
  handle?: string | null;
  deps?: {
    resolveUser?: typeof resolveXUser;
    pullReplies?: typeof pullOwnReplies;
    generateCard?: typeof generateVoiceCard;
    foldLocal?: typeof foldLocalVoiceSources;
  };
}): Promise<UserIngestResult> {
  const user = opts.user;
  const tenantId = ensureUserTenant(user.id);
  const profile = ensureVoiceProfile(user.id, tenantId);
  const priorStatus = profile.status;
  const handle = opts.handle ?? resolveIngestHandle(user);
  const resolveUser = opts.deps?.resolveUser ?? resolveXUser;
  const pullReplies = opts.deps?.pullReplies ?? pullOwnReplies;
  const generateCard = opts.deps?.generateCard ?? generateVoiceCard;
  const foldLocal = opts.deps?.foldLocal ?? foldLocalVoiceSources;
  setVoiceProfileStatus(user.id, "learning");

  const fail = (
    error: string,
    message: string,
  ): UserIngestResult => {
    const current = getVoiceProfile(user.id);
    updateVoiceProfilePull({
      userId: user.id,
      xUsername: current?.xUsername ?? null,
      sinceId: current?.sinceId ?? null,
      lastPullAt: nowIso(),
    });
    setVoiceProfileStatus(
      user.id,
      priorStatus === "ready" ? "ready" : "empty",
      message,
    );
    return {
      ok: false,
      userId: user.id,
      conversationCount: getVoiceProfile(user.id)?.conversationCount ?? 0,
      unlocked: false,
      pulled: 0,
      ownPostsIngested: 0,
      error,
      message,
    };
  };

  try {
    await foldLocal(user.id);
    let updated = getVoiceProfile(user.id);
    let pulled = 0;
    let ownPostsIngested = 0;

    if (handle) {
      const resolved = await resolveUser(handle, { get: ingestGet });
      if (!resolved.ok) {
        return fail(resolved.error, resolved.message);
      }
      if (resolved.protected) {
        return fail(
          "account_protected",
          `@${handle} is protected. Voice only reads public posts — there is no workaround, and we will not scrape.`,
        );
      }
      const sinceId = opts.mode === "hourly" ? profile.sinceId : null;
      const pull = await pullReplies({
        xUserId: resolved.id,
        sinceId,
        targetReplies:
          sinceId === null ? VOICE_TARGET_POSTS : 40,
        deps: { get: ingestGet },
      });
      if (!pull.ok) {
        return fail(pull.error, pull.message);
      }
      pulled = pull.replies.length;
      upsertVoiceReplies(user.id, pull.replies);
      await foldLocal(user.id);
      ownPostsIngested = foldRepliesIntoOwnPosts({
        userId: user.id,
        replies: pull.replies,
        xUserId: resolved.id,
        handle: resolved.username,
      });
      updateVoiceProfilePull({
        userId: user.id,
        xUsername: resolved.username,
        xUserId: resolved.id,
        sinceId: pull.completed
          ? (pull.newestId ?? profile.sinceId)
          : profile.sinceId,
        lastPullAt: nowIso(),
      });
    } else {
      updateVoiceProfilePull({
        userId: user.id,
        xUsername: null,
        lastPullAt: nowIso(),
      });
    }

    updated = getVoiceProfile(user.id);
    const conversations = updated?.conversationCount ?? 0;
    const posts = updated?.replyCount ?? 0;
    const unlocked = voiceUnlocked(posts);
    const hadCard = Boolean(updated?.cardJson);
    // The corpus moved this pull: the stored count grew (duplicate re-pulls
    // keep the cursor and do not add rows, so they must not trigger a rewrite).
    const corpusGrew = posts > profile.replyCount;
    if (unlocked && !hadCard) {
      const cardResult = await generateCard({
        handle: handle || "you",
        replies: listVoiceReplies(user.id, 120),
      });
      if (cardResult.ok) {
        saveVoiceCard({
          userId: user.id,
          cardJson: cardResult.cardJson,
          model: cardResult.model,
        });
      } else {
        setVoiceProfileStatus(
          user.id,
          priorStatus === "ready" ? "ready" : "empty",
          cardResult.message,
        );
      }
    } else if (
      unlocked &&
      hadCard &&
      opts.mode === "hourly" &&
      corpusGrew &&
      voiceCardStale(updated?.cardAttemptAt ?? null)
    ) {
      // Hourly rewrite so the card tracks the growing corpus. The >24h
      // staleness gate caps this at once per UTC day; the attempt stamp is
      // recorded up front so a failed generation is not retried next hour.
      stampVoiceCardAttempt(user.id);
      const cardResult = await generateCard({
        handle: handle || "you",
        replies: listVoiceReplies(user.id, 120),
      });
      if (cardResult.ok) {
        saveVoiceCard({
          userId: user.id,
          cardJson: cardResult.cardJson,
          model: cardResult.model,
        });
      } else {
        setVoiceProfileStatus(user.id, "ready");
      }
    } else {
      setVoiceProfileStatus(
        user.id,
        priorStatus === "ready" || hadCard ? "ready" : "empty",
      );
    }

    updated = getVoiceProfile(user.id);
    return {
      ok: true,
      userId: user.id,
      conversationCount: updated?.conversationCount ?? conversations,
      unlocked: voiceUnlocked(updated?.replyCount ?? posts),
      pulled,
      ownPostsIngested,
    };
  } finally {
    const current = getVoiceProfile(user.id);
    if (current && current.status === "learning") {
      setVoiceProfileStatus(
        user.id,
        priorStatus === "ready" ? "ready" : "empty",
      );
    }
  }
}

export async function ingestUsersHourly(opts?: {
  users?: AuthUser[];
  limit?: number;
}): Promise<{ ran: number; unlocked: number; pulled: number }> {
  const users = (opts?.users ?? listIngestUsers()).slice(
    0,
    Math.min(opts?.limit ?? 20, 40),
  );
  let ran = 0;
  let unlocked = 0;
  let pulled = 0;
  for (const user of users) {
    try {
      const result = await runUserIngest({ user, mode: "hourly" });
      ran += 1;
      pulled += result.pulled;
      if (result.unlocked) unlocked += 1;
      if (!result.ok) {
        console.warn(
          `[ingest] hourly soft-fail user=${user.id}: ${result.error ?? "unknown"}`,
        );
      }
    } catch (err) {
      console.warn("[ingest] hourly soft-fail:", err);
      const current = getVoiceProfile(user.id);
      updateVoiceProfilePull({
        userId: user.id,
        xUsername: current?.xUsername ?? null,
        sinceId: current?.sinceId ?? null,
        lastPullAt: nowIso(),
      });
    }
  }
  return { ran, unlocked, pulled };
}
