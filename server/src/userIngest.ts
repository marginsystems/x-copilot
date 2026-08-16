/**
 * Platform-paced ingest: one initial pull at onboarding, then hourly
 * incremental updates. Not user-triggered. Does not debit Scout credits.
 */
import type { AuthUser } from "./authStore.js";
import {
  getUserById,
  getXOauthUsername,
  listIngestUsers,
} from "./authStore.js";
import { dailyActivityUsage, ensureUserTenant } from "./billingStore.js";
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
  MAX_TIMELINE_PAGES,
  VOICE_TARGET_REPLIES,
  type XApiGetFn,
} from "./voiceIngest.js";
import {
  ensureVoiceProfile,
  getVoiceProfile,
  listVoiceReplies,
  nowIso,
  saveVoiceCard,
  setVoiceProfileStatus,
  updateVoiceProfilePull,
  upsertVoiceReplies,
  voiceUnlocked,
  type VoiceReplyInput,
} from "./voiceStore.js";
import { xApiGet } from "./xApi.js";
import { parseXHandle } from "./xHandle.js";
import type { ParsedPostCreate } from "./xActivity.js";

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
  return parseXHandle(user.xUsername ?? "") ?? getXOauthUsername(user.id);
}

function replyToOwnPost(
  reply: VoiceReplyInput,
  opts: { xUserId: string; handle: string },
): ParsedPostCreate {
  return {
    eventUuid: `ingest:${reply.id}`,
    xUserId: opts.xUserId,
    postId: reply.id,
    kind: "reply",
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
  if (!activity.can_watch) return 0;
  const tenantId = ensureUserTenant(opts.userId);
  let n = 0;
  for (const reply of opts.replies) {
    if (!reply.id.trim()) continue;
    if (countOwnPostsSince(opts.userId, startOfUtcDayIso()) >= activity.limit) {
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
 * Memories first, then official timeline. `initial` aims at ~100 replies.
 * `hourly` only reads since the stored cursor. Never bills the user pool.
 */
export async function runUserIngest(opts: {
  user: AuthUser;
  mode: IngestMode;
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
  const handle = resolveIngestHandle(user);
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
          `@${handle} is protected. Voice only reads public replies — there is no workaround, and we will not scrape.`,
        );
      }
      const sinceId = opts.mode === "hourly" ? profile.sinceId : null;
      const pull = await pullReplies({
        xUserId: resolved.id,
        sinceId,
        targetReplies:
          sinceId === null ? VOICE_TARGET_REPLIES : 40,
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
        sinceId:
          pull.completed || pull.pages >= MAX_TIMELINE_PAGES
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
    const unlocked = voiceUnlocked(conversations);
    const hadCard = Boolean(updated?.cardJson);
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
      unlocked: voiceUnlocked(updated?.conversationCount ?? conversations),
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
    }
  }
  return { ran, unlocked, pulled };
}
