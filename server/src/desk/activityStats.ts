/**
 * Pure bucketing of marked interactions and classified own posts for the
 * Threads activity dashboard. Bars stack original / quote / reply; the
 * views line still uses sampled snapshots.
 */
import type { Interaction } from "./interactionStore.js";
import type { OwnPostKind } from "../x-api/xActivity.js";
import type { ActivityOwnPost } from "./ownPostStore.js";

export type ActivityBucket = "day" | "week";

export type ActivityPostKind = "original" | "quote" | "reply";

export type ActivitySeriesPoint = {
  /** UTC day `YYYY-MM-DD` or ISO week `YYYY-Www`. */
  period: string;
  interactions: number;
  originals: number;
  quotes: number;
  replies: number;
  views: number;
  withStats: number;
};

export type ActivityStatsResult = {
  bucket: ActivityBucket;
  series: ActivitySeriesPoint[];
  totals: {
    interactions: number;
    originals: number;
    quotes: number;
    replies: number;
    views: number;
    withStats: number;
  };
};

export const ACTIVITY_DAY_WINDOW = 28;
export const ACTIVITY_WEEK_WINDOW = 12;
/** One batched tweet lookup for marks that still lack 1h/24h snapshots. */
export const LIVE_METRICS_ID_CAP = 25;

export function parseActivityBucket(raw: unknown): ActivityBucket {
  return raw === "week" ? "week" : "day";
}

/** Prefer mature 24h views, else 1h; missing → 0 for the sum. */
export function viewsForInteraction(row: Interaction): number {
  const v24 = row.stats?.t24h?.views;
  if (typeof v24 === "number" && Number.isFinite(v24) && v24 >= 0) return v24;
  const v1 = row.stats?.t1h?.views;
  if (typeof v1 === "number" && Number.isFinite(v1) && v1 >= 0) return v1;
  return 0;
}

export function interactionHasViewStats(row: Interaction): boolean {
  const v24 = row.stats?.t24h?.views;
  if (typeof v24 === "number" && Number.isFinite(v24) && v24 >= 0) return true;
  const v1 = row.stats?.t1h?.views;
  return typeof v1 === "number" && Number.isFinite(v1) && v1 >= 0;
}

function utcDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO week key `YYYY-Www` (UTC). */
export function utcWeekKey(ms: number): string {
  const d = new Date(ms);
  // Thursday in current week decides the year.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const y = d.getUTCFullYear();
  return `${y}-W${String(week).padStart(2, "0")}`;
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Monday 00:00 UTC of the ISO week containing `ms`. */
function startOfUtcIsoWeek(ms: number): number {
  const d = new Date(ms);
  const day = d.getUTCDay() || 7;
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.getTime();
}

function buildDayPeriods(nowMs: number, count: number): string[] {
  const end = startOfUtcDay(nowMs);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(utcDayKey(end - i * 86400000));
  }
  return out;
}

function buildWeekPeriods(nowMs: number, count: number): string[] {
  const end = startOfUtcIsoWeek(nowMs);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out.push(utcWeekKey(end - i * 7 * 86400000));
  }
  return out;
}

function emptyPoint(period: string): ActivitySeriesPoint {
  return {
    period,
    interactions: 0,
    originals: 0,
    quotes: 0,
    replies: 0,
    views: 0,
    withStats: 0,
  };
}

function emptyTotals(): ActivityStatsResult["totals"] {
  return {
    interactions: 0,
    originals: 0,
    quotes: 0,
    replies: 0,
    views: 0,
    withStats: 0,
  };
}

export type ClassifiedActivityPost = {
  id: string;
  postedAt: string;
  kind: ActivityPostKind;
  views: number;
  withStats: boolean;
};

export function activityWindowStartIso(nowMs = Date.now()): string {
  return new Date(nowMs - ACTIVITY_WEEK_WINDOW * 7 * 86400000).toISOString();
}

/** Persist the collector's kind. A re-quote stored as original stays OG. */
export function activityKindFromOwnPost(
  kind: OwnPostKind,
): ActivityPostKind | null {
  if (kind === "repost") return null;
  return kind;
}

export function classifyInteractionFallback(
  row: Pick<Interaction, "inReplyToId">,
): ActivityPostKind {
  return row.inReplyToId ? "reply" : "original";
}

/**
 * Prefer the own-post ledger's kind. Marks whose reply is not in the ledger
 * still count so a webhook-less desk does not lose its flight path.
 */
export function mergeClassifiedActivity(opts: {
  ownPosts: readonly ActivityOwnPost[];
  history: readonly Interaction[];
}): ClassifiedActivityPost[] {
  const byId = new Map<string, ClassifiedActivityPost>();
  for (const post of opts.ownPosts) {
    const kind = activityKindFromOwnPost(post.kind);
    if (!kind) continue;
    byId.set(post.id, {
      id: post.id,
      postedAt: post.postedAt,
      kind,
      views: post.views,
      withStats: post.withStats,
    });
  }
  for (const row of opts.history) {
    const replyId = row.replyId?.trim();
    if (replyId && byId.has(replyId)) {
      const existing = byId.get(replyId)!;
      existing.views = Math.max(existing.views, viewsForInteraction(row));
      existing.withStats = existing.withStats || interactionHasViewStats(row);
      continue;
    }
    const postedAt = row.postedAt || row.at;
    const id = replyId || `mark:${row.threadId}:${row.at}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      postedAt,
      kind: classifyInteractionFallback(row),
      views: viewsForInteraction(row),
      withStats: interactionHasViewStats(row),
    });
  }
  return [...byId.values()];
}

function addPostToPoint(
  point: ActivitySeriesPoint,
  totals: ActivityStatsResult["totals"],
  kind: ActivityPostKind,
  views: number,
  withStats: boolean,
): void {
  point.interactions += 1;
  totals.interactions += 1;
  if (kind === "original") {
    point.originals += 1;
    totals.originals += 1;
  } else if (kind === "quote") {
    point.quotes += 1;
    totals.quotes += 1;
  } else {
    point.replies += 1;
    totals.replies += 1;
  }
  point.views += views;
  totals.views += views;
  if (withStats) {
    point.withStats += 1;
    totals.withStats += 1;
  }
}

/**
 * Bucket retained interaction history into a stable day/week series.
 * Callers should pass the durable store retain (see MAX_INTERACTION_STORE),
 * not the 200-row Interacted feed cap — window filtering runs here after load.
 */
export function bucketInteractions(
  history: readonly Interaction[],
  opts: { bucket: ActivityBucket; now?: number },
): ActivityStatsResult {
  return bucketClassifiedPosts(
    mergeClassifiedActivity({ ownPosts: [], history }),
    opts,
  );
}

function postTimeMs(postedAt: string): number | null {
  const t = Date.parse(postedAt);
  return Number.isFinite(t) ? t : null;
}

/** Bucket classified own posts (plus leftover marks) into a day/week series. */
export function bucketClassifiedPosts(
  posts: readonly ClassifiedActivityPost[],
  opts: { bucket: ActivityBucket; now?: number },
): ActivityStatsResult {
  const nowMs = opts.now ?? Date.now();
  const bucket = opts.bucket;
  const periods =
    bucket === "week"
      ? buildWeekPeriods(nowMs, ACTIVITY_WEEK_WINDOW)
      : buildDayPeriods(nowMs, ACTIVITY_DAY_WINDOW);
  const periodSet = new Set(periods);
  const byPeriod = new Map<string, ActivitySeriesPoint>();
  for (const period of periods) {
    byPeriod.set(period, emptyPoint(period));
  }
  const totals = emptyTotals();

  for (const post of posts) {
    const t = postTimeMs(post.postedAt);
    if (t === null) continue;
    const key = bucket === "week" ? utcWeekKey(t) : utcDayKey(t);
    if (!periodSet.has(key)) continue;
    const point = byPeriod.get(key);
    if (!point) continue;
    addPostToPoint(point, totals, post.kind, post.views, post.withStats);
  }

  return {
    bucket,
    series: periods.map((p) => byPeriod.get(p)!),
    totals,
  };
}

/** Marked reply ids that still have no 1h/24h snapshot (oldest first, capped). */
export function pendingReplyIds(
  history: readonly Interaction[],
  cap: number = LIVE_METRICS_ID_CAP,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of history) {
    const id = row.replyId?.trim();
    if (!id || seen.has(id)) continue;
    if (interactionHasViewStats(row)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= cap) break;
  }
  return out;
}

export type LiveMetric = { views?: number; likes?: number };

/** In-memory only — do not persist as t1h (hourly worker owns checkpoints). */
export function mergeLiveMetrics(
  history: readonly Interaction[],
  live: ReadonlyMap<string, LiveMetric>,
  sampledAt: string = new Date().toISOString(),
): Interaction[] {
  if (live.size === 0) return [...history];
  return history.map((row) => {
    const id = row.replyId?.trim();
    if (!id || interactionHasViewStats(row)) return row;
    const m = live.get(id);
    // Only a finite views value resolves a row: a likes-only tweet (X omits
    // impression_count) must not write a t1h snapshot with views undefined,
    // which would never satisfy interactionHasViewStats and stay re-fetched.
    if (
      !m ||
      typeof m.views !== "number" ||
      !Number.isFinite(m.views) ||
      m.views < 0
    ) {
      return row;
    }
    return {
      ...row,
      stats: {
        ...row.stats,
        t1h: {
          views: m.views,
          likes: m.likes,
          sampledAt,
        },
      },
    };
  });
}
