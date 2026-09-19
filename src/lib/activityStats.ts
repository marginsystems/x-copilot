/** Client types + fetch for GET /api/interacted/stats. */

import { apiFetch } from "./apiBase";

export type ActivityBucket = "day" | "week";

export type ActivitySeriesPoint = {
  period: string;
  interactions: number;
  originals: number;
  quotes: number;
  replies: number;
  views: number;
  withStats: number;
};

export type ActivityKindCounts = {
  originals: number;
  quotes: number;
  replies: number;
};

export type ActivityStats = {
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

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

export function emptyActivityStats(bucket: ActivityBucket): ActivityStats {
  return {
    bucket,
    series: [],
    totals: {
      interactions: 0,
      originals: 0,
      quotes: 0,
      replies: 0,
      views: 0,
      withStats: 0,
    },
  };
}

/** Stack order: originals at the baseline, quotes, then replies on top. */
export function postKindCounts(
  point: Pick<
    ActivitySeriesPoint,
    "interactions" | "originals" | "quotes" | "replies"
  >,
): ActivityKindCounts {
  const originals = finiteCount(point.originals);
  const quotes = finiteCount(point.quotes);
  const replies = finiteCount(point.replies);
  if (originals + quotes + replies > 0) return { originals, quotes, replies };
  return { originals: 0, quotes: 0, replies: finiteCount(point.interactions) };
}

export function postKindTotal(kinds: ActivityKindCounts): number {
  return kinds.originals + kinds.quotes + kinds.replies;
}

export type BarSegment = {
  key: "original" | "quote" | "reply";
  count: number;
  height: number;
};

export function stackBarSegments(
  kinds: ActivityKindCounts,
  maxTotal: number,
  innerH: number,
): BarSegment[] {
  const max = Math.max(maxTotal, 1);
  return (
    [
      ["original", kinds.originals],
      ["quote", kinds.quotes],
      ["reply", kinds.replies],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({
      key,
      count,
      height: (count / max) * innerH,
    }));
}

export function parseActivityStats(
  raw: unknown,
  expectedBucket?: ActivityBucket,
): ActivityStats | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Partial<ActivityStats>;
  if (!data || (data.bucket !== "day" && data.bucket !== "week")) return null;
  if (expectedBucket && data.bucket !== expectedBucket) return null;
  if (!Array.isArray(data.series) || !data.totals) return null;
  return {
    bucket: data.bucket,
    series: data.series.map((p) => ({
      period: String(p.period ?? ""),
      interactions: finiteCount(p.interactions),
      originals: finiteCount(p.originals),
      quotes: finiteCount(p.quotes),
      replies: finiteCount(p.replies),
      views: finiteCount(p.views),
      withStats: finiteCount(p.withStats),
    })),
    totals: {
      interactions: finiteCount(data.totals.interactions),
      originals: finiteCount(data.totals.originals),
      quotes: finiteCount(data.totals.quotes),
      replies: finiteCount(data.totals.replies),
      views: finiteCount(data.totals.views),
      withStats: finiteCount(data.totals.withStats),
    },
  };
}

export async function fetchActivityStats(
  bucket: ActivityBucket,
): Promise<ActivityStats | null> {
  try {
    const res = await apiFetch(`/api/interacted/stats?bucket=${bucket}`);
    if (!res.ok) return null;
    return parseActivityStats(await res.json(), bucket);
  } catch {
    return null;
  }
}

/**
 * Views-line Y source. Days with marks but no sample hold the last sampled
 * altitude so today does not crash to zero.
 */
export function viewsLineAltitude(
  point: ActivitySeriesPoint,
  lastSampledViews: number,
): { views: number; held: boolean } {
  if (point.views > 0 || point.withStats > 0) {
    return { views: point.views, held: false };
  }
  if (point.interactions > 0) {
    return { views: lastSampledViews, held: true };
  }
  return { views: 0, held: false };
}

/** Short x-axis label for day (`MM-DD`) or week (`Wnn`). */
export function formatPeriodLabel(period: string, bucket: ActivityBucket): string {
  if (bucket === "week") {
    const m = period.match(/W(\d{2})$/);
    return m ? `W${m[1]}` : period;
  }
  const m = period.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}-${m[2]}` : period;
}

/** Popover title: `8/11` or `Week 33`. */
export function formatPeriodTip(period: string, bucket: ActivityBucket): string {
  if (bucket === "week") {
    const m = period.match(/W(\d{2})$/);
    return m ? `Week ${Number(m[1])}` : period;
  }
  const m = period.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[1])}/${Number(m[2])}` : period;
}

export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function activityChartTipDetail(
  posts: number,
  views: number,
  held: boolean,
  kinds?: ActivityKindCounts,
): string {
  const postLabel = posts === 1 ? "1 post" : `${formatCount(posts)} posts`;
  const head = held
    ? `${postLabel} · views pending`
    : `${postLabel} · ${formatCount(views)} views`;
  if (!kinds) return head;
  const mix = [
    kinds.originals > 0
      ? `${formatCount(kinds.originals)} OG`
      : null,
    kinds.quotes > 0
      ? `${formatCount(kinds.quotes)} ${kinds.quotes === 1 ? "quote" : "quotes"}`
      : null,
    kinds.replies > 0
      ? `${formatCount(kinds.replies)} ${kinds.replies === 1 ? "reply" : "replies"}`
      : null,
  ].filter(Boolean);
  return mix.length ? `${head} · ${mix.join(" · ")}` : head;
}
