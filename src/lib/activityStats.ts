/** Client types + fetch for GET /api/interacted/stats. */

import { apiFetch } from "./apiBase";

export type ActivityBucket = "day" | "week";

export type ActivitySeriesPoint = {
  period: string;
  interactions: number;
  views: number;
  withStats: number;
};

export type ActivityStats = {
  bucket: ActivityBucket;
  series: ActivitySeriesPoint[];
  totals: {
    interactions: number;
    views: number;
    withStats: number;
  };
};

export function emptyActivityStats(bucket: ActivityBucket): ActivityStats {
  return {
    bucket,
    series: [],
    totals: { interactions: 0, views: 0, withStats: 0 },
  };
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
      interactions:
        typeof p.interactions === "number" && Number.isFinite(p.interactions)
          ? p.interactions
          : 0,
      views: typeof p.views === "number" && Number.isFinite(p.views) ? p.views : 0,
      withStats:
        typeof p.withStats === "number" && Number.isFinite(p.withStats)
          ? p.withStats
          : 0,
    })),
    totals: {
      interactions:
        typeof data.totals.interactions === "number" &&
        Number.isFinite(data.totals.interactions)
          ? data.totals.interactions
          : 0,
      views:
        typeof data.totals.views === "number" && Number.isFinite(data.totals.views)
          ? data.totals.views
          : 0,
      withStats:
        typeof data.totals.withStats === "number" &&
        Number.isFinite(data.totals.withStats)
          ? data.totals.withStats
          : 0,
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
): string {
  const postLabel = posts === 1 ? "1 post" : `${formatCount(posts)} posts`;
  return held ? `${postLabel} · views pending` : `${postLabel} · ${formatCount(views)} views`;
}
