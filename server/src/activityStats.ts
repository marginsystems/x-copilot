/**
 * Pure bucketing of marked interactions for the Threads activity dashboard.
 * Source of truth = interaction history + existing 1h/24h reply-stat samples.
 */
import type { Interaction } from "./interactionStore.js";

export type ActivityBucket = "day" | "week";

export type ActivitySeriesPoint = {
  /** UTC day `YYYY-MM-DD` or ISO week `YYYY-Www`. */
  period: string;
  interactions: number;
  views: number;
  withStats: number;
};

export type ActivityStatsResult = {
  bucket: ActivityBucket;
  series: ActivitySeriesPoint[];
  totals: {
    interactions: number;
    views: number;
    withStats: number;
  };
};

export const ACTIVITY_DAY_WINDOW = 28;
export const ACTIVITY_WEEK_WINDOW = 12;

export function parseActivityBucket(raw: unknown): ActivityBucket {
  return raw === "week" ? "week" : "day";
}

function markTimeMs(row: Interaction): number | null {
  const primary = Date.parse(row.at);
  if (Number.isFinite(primary)) return primary;
  if (row.postedAt) {
    const fallback = Date.parse(row.postedAt);
    if (Number.isFinite(fallback)) return fallback;
  }
  return null;
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

/**
 * Bucket retained interaction history into a stable day/week series.
 * Callers should pass the durable store retain (see MAX_INTERACTION_STORE),
 * not the 200-row Interacted feed cap — window filtering runs here after load.
 */
export function bucketInteractions(
  history: readonly Interaction[],
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
    byPeriod.set(period, {
      period,
      interactions: 0,
      views: 0,
      withStats: 0,
    });
  }

  let totalsInteractions = 0;
  let totalsViews = 0;
  let totalsWithStats = 0;

  for (const row of history) {
    const t = markTimeMs(row);
    if (t === null) continue;
    const key = bucket === "week" ? utcWeekKey(t) : utcDayKey(t);
    if (!periodSet.has(key)) continue;
    const point = byPeriod.get(key);
    if (!point) continue;
    const views = viewsForInteraction(row);
    const withStats = interactionHasViewStats(row);
    point.interactions += 1;
    point.views += views;
    if (withStats) point.withStats += 1;
    totalsInteractions += 1;
    totalsViews += views;
    if (withStats) totalsWithStats += 1;
  }

  return {
    bucket,
    series: periods.map((p) => byPeriod.get(p)!),
    totals: {
      interactions: totalsInteractions,
      views: totalsViews,
      withStats: totalsWithStats,
    },
  };
}
