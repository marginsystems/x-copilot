/**
 * Expire stale cool threads from one user's Scout tank into their expired
 * history. Never touches another user's tank or rows.
 */
import { getDismissedThreadIds } from "./dismissalStore.js";
import {
  getExpiredThreadIds,
  markExpired,
  selectStaleThreads,
  type ExpiredThread,
} from "./expiredStore.js";
import { listActiveInteractions } from "./interactionStore.js";
import {
  getLastScout,
  listScoutTankUserIds,
  pruneThreadsFromScoutCache,
} from "./scoutCache.js";

export type ExpirePassResult = {
  expired: number;
  ids: string[];
};

export async function runExpirePass(opts: {
  userId: string;
  nowMs?: number;
}): Promise<ExpirePassResult> {
  const userId = opts.userId;
  const nowMs = opts.nowMs ?? Date.now();
  const snapshot = await getLastScout({ userId });
  if (!snapshot?.threads.length) {
    return { expired: 0, ids: [] };
  }

  const [interacted, dismissed, alreadyExpired] = await Promise.all([
    listActiveInteractions({ userId, nowMs }),
    getDismissedThreadIds({ userId }),
    getExpiredThreadIds({ userId }),
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
      userId,
      createdAt: t.createdAt,
      url: t.url,
      summary: t.summary,
      text: t.text,
      nowMs,
    });
    ids.push(t.id);
  }

  await pruneThreadsFromScoutCache(ids, { userId });
  return { expired: ids.length, ids };
}

/** Worker sweep: one expire pass per user who has a Scout tank. */
export async function runExpirePassForAllUsers(opts?: {
  nowMs?: number;
}): Promise<ExpirePassResult & { users: number }> {
  const users = listScoutTankUserIds();
  const acc: ExpirePassResult & { users: number } = {
    expired: 0,
    ids: [],
    users: users.length,
  };
  for (const userId of users) {
    try {
      const result = await runExpirePass({ userId, nowMs: opts?.nowMs });
      acc.expired += result.expired;
      acc.ids.push(...result.ids);
    } catch (err) {
      console.error(`expire pass failed user=${userId}:`, err);
    }
  }
  return acc;
}

/** Test helper type re-export. */
export type { ExpiredThread };
