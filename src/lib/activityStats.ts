/** Client types + fetch for GET /api/interacted/stats. */

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

export async function fetchActivityStats(
  bucket: ActivityBucket,
): Promise<ActivityStats | null> {
  try {
    const res = await fetch(`/api/interacted/stats?bucket=${bucket}`);
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<ActivityStats>;
    if (!data || (data.bucket !== "day" && data.bucket !== "week")) return null;
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
  } catch {
    return null;
  }
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
