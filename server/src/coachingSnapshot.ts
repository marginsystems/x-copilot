/**
 * Compact activity snapshot for next-action + daily missions.
 * Reads stores the desk already has — no extra X fetches.
 */
import { createHash } from "node:crypto";
import { getPlatformDb } from "./db.js";
import { getGamification } from "./gamification.js";
import { utcDayKey } from "./gamificationXp.js";
import { listInteractionHistory } from "./interactionStore.js";
import {
  countDoneSuggestionsSince,
  listActiveSuggestions,
} from "./forYouStore.js";
import { startOfUtcDayIso } from "./ownPostStore.js";
import { countDeliveredSortiesToday } from "./scoutSorties.js";
import {
  countDeskOriginalsSince,
  listDeskPostsSince,
} from "./xPostLimits.js";

export type CoachingSnapshot = {
  dayUtc: string;
  marksToday: number;
  originalsToday: number;
  repliesPostedToday: number;
  quotesToday: number;
  /** own_posts originals + quotes this UTC day. Not honor-system I posted. */
  postsToday: number;
  deskPostsToday: number;
  takeoffsToday: number;
  suggestions: {
    total: number;
    post: number;
    quote: number;
    repost: number;
    reply: number;
  };
  streak: number;
  lastMarkUtcDay: string | null;
  level: number;
  lifetimeXp: number;
};

export function originalsTodayCount(
  ownPosts: number,
  deskOriginals: number,
  doneForYouPosts: number,
): number {
  return Math.max(ownPosts, deskOriginals, doneForYouPosts);
}

export function hashCoachingSnapshot(snapshot: CoachingSnapshot): string {
  return createHash("sha256")
    .update(
      JSON.stringify(snapshot, (key, value) =>
        key === "lifetimeXp" || key === "level" ? undefined : value,
      ),
    )
    .digest("hex")
    .slice(0, 32);
}

function countOwnKindsToday(
  userId: string,
  sinceIso: string,
): { originals: number; replies: number; quotes: number } {
  const rows = getPlatformDb()
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM own_posts
        WHERE user_id = ? AND posted_at >= ?
        GROUP BY kind`,
    )
    .all(userId, sinceIso) as Array<{ kind: string; n: number }>;
  let originals = 0;
  let replies = 0;
  let quotes = 0;
  for (const row of rows) {
    const n = Number(row.n) || 0;
    if (row.kind === "original") originals = n;
    else if (row.kind === "reply") replies = n;
    else if (row.kind === "quote") quotes = n;
  }
  return { originals, replies, quotes };
}

export async function buildCoachingSnapshot(opts: {
  userId: string;
  tenantId: string;
  nowMs?: number;
  interactionStorePath?: string;
  gamificationPath?: string;
}): Promise<CoachingSnapshot> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayUtc = utcDayKey(nowMs);
  const sinceIso = startOfUtcDayIso(new Date(nowMs));
  const [history, gamification] = await Promise.all([
    listInteractionHistory({
      userId: opts.userId,
      limit: 400,
      storePath: opts.interactionStorePath,
    }),
    getGamification({
      userId: opts.userId,
      nowMs,
      gamificationPath: opts.gamificationPath,
      interactionStorePath: opts.interactionStorePath,
    }),
  ]);
  let marksToday = 0;
  for (const row of history) {
    // Off-app replies (webhook / hourly `discovered`) are today's marks too.
    // XP and streak keep their own rules in gamification.
    if (row.source !== "manual" && row.source !== "discovered") continue;
    const at = Date.parse(row.at);
    if (Number.isFinite(at) && utcDayKey(at) === dayUtc) marksToday += 1;
  }
  const kinds = countOwnKindsToday(opts.userId, sinceIso);
  const deskOriginals = countDeskOriginalsSince(opts.userId, sinceIso);
  const doneForYouPosts = countDoneSuggestionsSince({
    userId: opts.userId,
    kind: "post",
    sinceIso,
  });
  const suggestions = listActiveSuggestions(opts.userId, nowMs);
  const counts = { post: 0, quote: 0, repost: 0, reply: 0 };
  for (const row of suggestions) {
    counts[row.kind] += 1;
  }
  return {
    dayUtc,
    marksToday,
    originalsToday: originalsTodayCount(
      kinds.originals,
      deskOriginals,
      doneForYouPosts,
    ),
    repliesPostedToday: kinds.replies,
    quotesToday: kinds.quotes,
    postsToday: kinds.originals + kinds.quotes,
    deskPostsToday: listDeskPostsSince(opts.userId, sinceIso).length,
    takeoffsToday: countDeliveredSortiesToday(opts.tenantId, new Date(nowMs)),
    suggestions: { total: suggestions.length, ...counts },
    streak: gamification.currentStreak,
    lastMarkUtcDay: gamification.lastMarkUtcDay,
    level: gamification.level,
    lifetimeXp: gamification.lifetimeXp,
  };
}
