import { parseCreatedAt } from "./timeAgo";

type HasCreatedAt = { createdAt?: string };
type HasAudience = { views?: number };

export function audienceViews(thread: HasAudience): number {
  const n = thread.views;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** Highest impression count first. Missing views sink. */
export function sortThreadsByAudience<T extends HasAudience>(threads: T[]): T[] {
  return [...threads].sort((a, b) => audienceViews(b) - audienceViews(a));
}

/** Newest tweet first; missing/unparseable createdAt sinks to the bottom. */
export function sortThreadsByCreatedAtNewest<T extends HasCreatedAt>(
  threads: T[],
): T[] {
  return [...threads].sort((a, b) => {
    const ta = parseCreatedAt(a.createdAt)?.getTime() ?? 0;
    const tb = parseCreatedAt(b.createdAt)?.getTime() ?? 0;
    if (ta === 0 && tb === 0) return 0;
    if (ta === 0) return 1;
    if (tb === 0) return -1;
    return tb - ta;
  });
}
