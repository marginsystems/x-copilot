import { parseCreatedAt } from "./timeAgo";

type HasCreatedAt = { createdAt?: string };

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
