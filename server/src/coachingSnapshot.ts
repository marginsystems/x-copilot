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
  listDonePostActedAtSince,
  listActiveSuggestions,
} from "./forYouStore.js";
import {
  listOwnOriginalsSince,
  listOwnPostedAt,
  startOfUtcDayIso,
} from "./ownPostStore.js";
import { countDeliveredSortiesToday } from "./scoutSorties.js";
import {
  countDeskOriginalsSince,
  listDeskOriginalsSince,
  listDeskPostsSince,
} from "./xPostLimits.js";

export type CoachingSnapshot = {
  dayUtc: string;
  marksToday: number;
  /** Desk/manual marks today; off-app discoveries are excluded from missions. */
  manualMarksToday?: number;
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

export const INSTRUMENT_WINDOW = 2000;
const INSTRUMENT_HISTORY_MS = 14 * 24 * 60 * 60 * 1000;

export type InstrumentTimes = {
  replyAt: string[];
  originalAt: string[];
  postAt: string[];
};

export async function loadInstrumentTimes(opts: {
  userId: string;
  interactionStorePath?: string;
  nowMs?: number;
}): Promise<InstrumentTimes> {
  const history = await listInteractionHistory({
    userId: opts.userId,
    limit: INSTRUMENT_WINDOW,
    storePath: opts.interactionStorePath,
  });
  const sinceIso = new Date(
    (opts.nowMs ?? Date.now()) - INSTRUMENT_HISTORY_MS,
  ).toISOString();
  const [deskOriginalAt, donePostAt] = [
    listDeskOriginalsSince(opts.userId, sinceIso),
    listDonePostActedAtSince(opts.userId, sinceIso),
  ];
  // The same original can be represented by multiple stores. IDs are stable;
  // timestamps are not, because ingestion and confirmation happen separately.
  const originals: Array<{ id: string | null; at: string }> =
    listOwnOriginalsSince(opts.userId, sinceIso).map((row) => ({
      id: row.tweetId,
      at: row.postedAt,
    }));
  for (const candidate of deskOriginalAt) {
    if (candidate.tweetId && originals.some((row) => row.id === candidate.tweetId)) {
      continue;
    }
    originals.push({ id: candidate.tweetId, at: candidate.createdAt });
  }
  for (const candidate of donePostAt) {
    if (candidate.tweetId && originals.some((row) => row.id === candidate.tweetId)) {
      continue;
    }
    if (candidate.tweetId) {
      originals.push({ id: candidate.tweetId, at: candidate.actedAt });
    } else {
      originals.push({ id: null, at: candidate.actedAt });
    }
  }
  return {
    replyAt: history.map((row) => row.postedAt ?? row.at),
    originalAt: originals
      .map((row) => row.at)
      .sort((a, b) => Date.parse(b) - Date.parse(a))
      .slice(0, INSTRUMENT_WINDOW),
    postAt: listOwnPostedAt({
      userId: opts.userId,
      kinds: ["original", "quote"],
      limit: INSTRUMENT_WINDOW,
    }),
  };
}

export function coachingInstrumentFields(
  snapshot: Pick<CoachingSnapshot, "postsToday" | "originalsToday">,
  times: InstrumentTimes,
): {
  postsToday: number;
  originalsToday: number;
  replyAt: string[];
  originalAt: string[];
  postAt: string[];
} {
  return {
    postsToday: snapshot.postsToday,
    originalsToday: snapshot.originalsToday,
    replyAt: times.replyAt,
    originalAt: times.originalAt,
    postAt: times.postAt,
  };
}

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
  let manualMarksToday = 0;
  for (const row of history) {
    // Off-app replies (webhook / hourly `discovered`) are today's marks too.
    // XP and streak keep their own rules in gamification.
    if (row.source !== "manual" && row.source !== "discovered") continue;
    const at = Date.parse(row.at);
    if (Number.isFinite(at) && utcDayKey(at) === dayUtc) {
      marksToday += 1;
      if (row.source === "manual") manualMarksToday += 1;
    }
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
    manualMarksToday,
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
