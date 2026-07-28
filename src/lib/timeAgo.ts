/**
 * Format X/Twitter `created_at` (or any Date-parseable string) as a compact relative time.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function parseCreatedAt(raw: string | undefined | null): Date | null {
  if (!raw?.trim()) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/** Compact relative label: just now, 5m, 2h, 3d, 12 Jul, 12 Jul 2025 */
export function formatTimeAgo(
  raw: string | undefined | null,
  nowMs: number = Date.now(),
): string | null {
  const d = parseCreatedAt(raw);
  if (!d) return null;

  const diffMs = nowMs - d.getTime();
  // Stale `nowMs` (UI tick lag) can make brand-new rows look slightly in the future.
  // Treat small forward skew as "just now" so live Scout logs stay sensible.
  if (diffMs < -60_000) {
    return formatShortDate(d, nowMs);
  }

  const sec = Math.floor(Math.max(0, diffMs) / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d`;

  return formatShortDate(d, nowMs);
}

function formatShortDate(d: Date, nowMs: number): string {
  const month = MONTHS[d.getMonth()];
  const day = d.getDate();
  const year = d.getFullYear();
  const nowYear = new Date(nowMs).getFullYear();
  if (year === nowYear) return `${day} ${month}`;
  return `${day} ${month} ${year}`;
}

/** Absolute local timestamp for title/tooltip */
export function formatAbsoluteTime(raw: string | undefined | null): string | null {
  const d = parseCreatedAt(raw);
  if (!d) return null;
  return d.toLocaleString();
}
