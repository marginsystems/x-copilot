import { isRecord } from "../platform/unknownValue.js";
/**
 * Compact activity snapshot for next-action + daily missions.
 * Reads stores the desk already has — no extra X fetches.
 */
import { createHash } from "node:crypto";
import { getPlatformDb } from "../db.js";
import { getGamification } from "./gamification.js";
import { utcDayKey } from "./gamificationXp.js";
import { listInteractionHistory } from "./interactionStore.js";
import {
  countDoneSuggestionsSince,
  listDonePostActedAtSince,
  listActiveSuggestions,
} from "../for-you/forYouStore.js";
import {
  listOwnOriginalsSince,
  listOwnPostedAt,
  startOfUtcDayIso,
} from "./ownPostStore.js";
import { postUrl, type OwnPostKind } from "../x-api/xActivity.js";
import { countDeliveredSortiesToday } from "../scout/scoutSorties.js";
import {
  countDeskOriginalsSince,
  listDeskOriginalsSince,
  listDeskPostsSince,
} from "../x-api/xPostLimits.js";

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
export const INSTRUMENT_HISTORY_MS = 14 * 24 * 60 * 60 * 1000;

export type InstrumentTimes = {
  replyAt: string[];
  originalAt: string[];
  postAt: string[];
};

export type OwnActivity = {
  id: string;
  url: string;
  text: string;
  kind: Extract<OwnPostKind, "reply" | "original" | "quote">;
  postedAt: string;
};

function instrumentSinceMs(nowMs = Date.now()): number {
  return nowMs - INSTRUMENT_HISTORY_MS;
}

function withinInstrumentHistory(at: string, sinceMs: number): boolean {
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) && parsed >= sinceMs;
}

export function loadNewestOwnActivity(userId: string): OwnActivity | null {
  const row = parseLoadNewestOwnActivityRow(getPlatformDb()
    .prepare(
      `SELECT id, url, text, kind, posted_at AS postedAt
         FROM own_posts
        WHERE user_id = ? AND kind IN ('reply', 'original', 'quote')
        ORDER BY posted_at DESC
        LIMIT 1`,
    )
    .get(userId));
  if (!row) return null;
  return {
    id: row.id,
    url: row.url?.trim() || postUrl(null, row.id),
    text: row.text ?? "",
    kind: row.kind,
    postedAt: row.postedAt,
  };
}

export async function loadNewestInstrumentTimes(opts: {
  userId: string;
  nowMs?: number;
}): Promise<Pick<InstrumentTimes, "replyAt" | "postAt">> {
  const sinceMs = instrumentSinceMs(opts.nowMs);
  const history = await listInteractionHistory({
    userId: opts.userId,
    limit: INSTRUMENT_WINDOW,
  });
  return {
    replyAt: history
      .map((row) => row.postedAt ?? row.at)
      .filter((at) => withinInstrumentHistory(at, sinceMs))
      .slice(0, 1),
    postAt: listOwnPostedAt({
      userId: opts.userId,
      kinds: ["original", "quote"],
      limit: 1,
    })
      .filter((at) => withinInstrumentHistory(at, sinceMs))
      .slice(0, 1),
  };
}

export async function loadInstrumentTimes(opts: {
  userId: string;
  nowMs?: number;
}): Promise<InstrumentTimes> {
  const history = await listInteractionHistory({
    userId: opts.userId,
    limit: INSTRUMENT_WINDOW,
  });
  const sinceMs = instrumentSinceMs(opts.nowMs);
  const sinceIso = new Date(sinceMs).toISOString();
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
    replyAt: history
      .map((row) => row.postedAt ?? row.at)
      .filter((at) => withinInstrumentHistory(at, sinceMs)),
    originalAt: originals
      .map((row) => row.at)
      .sort((a, b) => Date.parse(b) - Date.parse(a))
      .slice(0, INSTRUMENT_WINDOW),
    postAt: listOwnPostedAt({
      userId: opts.userId,
      kinds: ["original", "quote"],
      limit: INSTRUMENT_WINDOW,
    }).filter((at) => withinInstrumentHistory(at, sinceMs)),
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
      JSON.stringify(snapshot, (key, value: unknown) =>
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
  const rows = parseCountOwnKindsTodayRow(getPlatformDb()
    .prepare(
      `SELECT kind, COUNT(*) AS n FROM own_posts
        WHERE user_id = ? AND posted_at >= ?
        GROUP BY kind`,
    )
    .all(userId, sinceIso));
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
  gamificationPath?: string;
}): Promise<CoachingSnapshot> {
  const nowMs = opts.nowMs ?? Date.now();
  const dayUtc = utcDayKey(nowMs);
  const sinceIso = startOfUtcDayIso(new Date(nowMs));
  const [history, gamification] = await Promise.all([
    listInteractionHistory({
      userId: opts.userId,
      limit: 400,
    }),
    getGamification({
      userId: opts.userId,
      nowMs,
      gamificationPath: opts.gamificationPath,
    }),
  ]);
  let marksToday = 0;
  let manualMarksToday = 0;
  for (const row of history) {
    // Off-app replies (webhook / hourly `discovered`) are today's marks too.
    // Streak is rebuilt from the same interacted history. XP is not backfilled.
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

function parseLoadNewestOwnActivityRow(value: unknown): | {
        id: string;
        url: string | null;
        text: string | null;
        kind: OwnActivity["kind"];
        postedAt: string;
      }
    | undefined {
  const valid = (row: unknown): row is | {
        id: string;
        url: string | null;
        text: string | null;
        kind: OwnActivity["kind"];
        postedAt: string;
      }
    | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.id === "string" &&
    (row.url === null || typeof row.url === "string") &&
    (row.text === null || typeof row.text === "string") &&
    (row.kind === "original" || row.kind === "reply" || row.kind === "quote") &&
    typeof row.postedAt === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function parseCountOwnKindsTodayRow(value: unknown): Array<{ kind: string; n: number }> {
  const valid = (row: unknown): row is Array<{ kind: string; n: number }> =>
    (Array.isArray(row) && row.every((item: unknown) => (isRecord(item) &&
    typeof item.kind === "string" &&
    typeof item.n === "number")));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
