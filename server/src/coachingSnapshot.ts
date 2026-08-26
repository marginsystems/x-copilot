/**
 * Compact activity snapshot for next-action + daily missions.
 * Reads stores the desk already has — no extra X fetches.
 */
import { createHash } from "node:crypto";
import { getPlatformDb } from "./db.js";
import { getGamification } from "./gamification.js";
import { utcDayKey } from "./gamificationXp.js";
import { listInteractionHistory } from "./interactionStore.js";
import { listActiveSuggestions } from "./forYouStore.js";
import { startOfUtcDayIso } from "./ownPostStore.js";
import { countSortiesToday } from "./scoutSorties.js";
import { listDeskPostsSince } from "./xPostLimits.js";

export type CoachingSnapshot = {
  dayUtc: string;
  marksToday: number;
  originalsToday: number;
  repliesPostedToday: number;
  quotesToday: number;
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

export function hashCoachingSnapshot(snapshot: CoachingSnapshot): string {
  return createHash("sha256")
    .update(JSON.stringify(snapshot))
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
}): Promise<CoachingSnapshot> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayUtc = utcDayKey(nowMs);
  const sinceIso = startOfUtcDayIso(new Date(nowMs));
  const [history, gamification] = await Promise.all([
    listInteractionHistory({ userId: opts.userId, limit: 400 }),
    getGamification({ userId: opts.userId, nowMs }),
  ]);
  let marksToday = 0;
  for (const row of history) {
    const at = Date.parse(row.at);
    if (Number.isFinite(at) && utcDayKey(at) === dayUtc) marksToday += 1;
  }
  const kinds = countOwnKindsToday(opts.userId, sinceIso);
  const suggestions = listActiveSuggestions(opts.userId, nowMs);
  const counts = { post: 0, quote: 0, repost: 0, reply: 0 };
  for (const row of suggestions) {
    counts[row.kind] += 1;
  }
  return {
    dayUtc,
    marksToday,
    originalsToday: kinds.originals,
    repliesPostedToday: kinds.replies,
    quotesToday: kinds.quotes,
    deskPostsToday: listDeskPostsSince(opts.userId, sinceIso).length,
    takeoffsToday: countSortiesToday(opts.tenantId, new Date(nowMs)),
    suggestions: { total: suggestions.length, ...counts },
    streak: gamification.currentStreak,
    lastMarkUtcDay: gamification.lastMarkUtcDay,
    level: gamification.level,
    lifetimeXp: gamification.lifetimeXp,
  };
}
