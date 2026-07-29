/**
 * Expire stale cool threads from last-scout into expiredStore.
 */
import { getDismissedThreadIds } from "./dismissalStore.js";
import {
  getExpiredThreadIds,
  markExpired,
  selectStaleThreads,
  type ExpiredThread,
} from "./expiredStore.js";
import { listInteractionHistory } from "./interactionStore.js";
import {
  getLastScout,
  pruneThreadsFromScoutCache,
} from "./scoutCache.js";

export type ExpirePassResult = {
  expired: number;
  ids: string[];
};

export async function runExpirePass(opts?: {
  nowMs?: number;
  scoutStorePath?: string;
  expiredStorePath?: string;
  interactionStorePath?: string;
  dismissalStorePath?: string;
}): Promise<ExpirePassResult> {
  const nowMs = opts?.nowMs ?? Date.now();
  const snapshot = await getLastScout({ storePath: opts?.scoutStorePath });
  if (!snapshot?.threads.length) {
    return { expired: 0, ids: [] };
  }

  const [interacted, dismissed, alreadyExpired] = await Promise.all([
    listInteractionHistory({ storePath: opts?.interactionStorePath }),
    getDismissedThreadIds({ storePath: opts?.dismissalStorePath }),
    getExpiredThreadIds({ storePath: opts?.expiredStorePath }),
  ]);

  const skipIds = new Set<string>([
    ...interacted.map((i) => i.threadId),
    ...dismissed,
    ...alreadyExpired,
  ]);

  const stale = selectStaleThreads(snapshot.threads, nowMs, skipIds);
  if (!stale.length) {
    return { expired: 0, ids: [] };
  }

  const ids: string[] = [];
  for (const t of stale) {
    await markExpired({
      threadId: t.id,
      author: t.author,
      createdAt: t.createdAt,
      url: t.url,
      summary: t.summary,
      text: t.text,
      nowMs,
      storePath: opts?.expiredStorePath,
    });
    ids.push(t.id);
  }

  await pruneThreadsFromScoutCache(ids, { storePath: opts?.scoutStorePath });
  return { expired: ids.length, ids };
}

/** Test helper type re-export. */
export type { ExpiredThread };
