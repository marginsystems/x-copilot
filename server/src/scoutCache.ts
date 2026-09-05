/**
 * Scout tank — one LastScoutSnapshot per platform user in `scout_tanks`.
 * Threads accumulate across runs (merge by id); other fields track the latest
 * run. Nothing is read from the old data/last-scout.json.
 */
import { ensureUserTenant } from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { requireUserId } from "./interactionStore.js";
import type { ThreadCard } from "./threadCard.js";

export type LastScoutSnapshot = {
  savedAt: string;
  agenda?: string;
  queries: string[];
  threads: ThreadCard[];
  message?: string;
  triageWarning?: string;
  cooldownWarning?: string;
  linkWarning?: string;
  lengthWarning?: string;
  pipelineCounts?: {
    raw: number;
    afterDedupe: number;
    afterCooldown: number;
    afterSelfReply?: number;
    afterLinks?: number;
    afterLength: number;
    afterTriage: number;
    minViewsFiltered?: number;
  };
};

function isThreadCard(value: unknown): value is ThreadCard {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.author === "string" &&
    typeof t.text === "string" &&
    typeof t.url === "string"
  );
}

export function parseScoutSnapshot(raw: unknown): LastScoutSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const savedAt = typeof obj.savedAt === "string" ? obj.savedAt : "";
  if (!savedAt || !Number.isFinite(Date.parse(savedAt))) return null;
  const queries = Array.isArray(obj.queries)
    ? obj.queries.filter((q): q is string => typeof q === "string")
    : [];
  const threads = Array.isArray(obj.threads)
    ? obj.threads.filter(isThreadCard)
    : [];
  for (const thread of threads) {
    const rawThread = thread as ThreadCard & { scoutAgendaSet?: unknown };
    if (typeof rawThread.scoutAgendaSet === "boolean") {
      thread.scoutAgendaSet = rawThread.scoutAgendaSet;
    }
  }
  const snapshot: LastScoutSnapshot = {
    savedAt,
    queries,
    threads,
  };
  if (typeof obj.agenda === "string") snapshot.agenda = obj.agenda;
  if (typeof obj.message === "string") snapshot.message = obj.message;
  if (typeof obj.triageWarning === "string") {
    snapshot.triageWarning = obj.triageWarning;
  }
  if (typeof obj.cooldownWarning === "string") {
    snapshot.cooldownWarning = obj.cooldownWarning;
  }
  if (typeof obj.linkWarning === "string") {
    snapshot.linkWarning = obj.linkWarning;
  }
  if (typeof obj.lengthWarning === "string") {
    snapshot.lengthWarning = obj.lengthWarning;
  }
  if (typeof obj.pipelineCounts === "object" && obj.pipelineCounts !== null) {
    const pc = obj.pipelineCounts as Record<string, unknown>;
    if (
      typeof pc.raw === "number" &&
      typeof pc.afterDedupe === "number" &&
      typeof pc.afterCooldown === "number" &&
      typeof pc.afterLength === "number" &&
      typeof pc.afterTriage === "number"
    ) {
      snapshot.pipelineCounts = {
        raw: pc.raw,
        afterDedupe: pc.afterDedupe,
        afterCooldown: pc.afterCooldown,
        afterLength: pc.afterLength,
        afterTriage: pc.afterTriage,
      };
      if (typeof pc.afterSelfReply === "number") {
        snapshot.pipelineCounts.afterSelfReply = pc.afterSelfReply;
      }
      if (typeof pc.afterLinks === "number") {
        snapshot.pipelineCounts.afterLinks = pc.afterLinks;
      }
      if (typeof pc.minViewsFiltered === "number") {
        snapshot.pipelineCounts.minViewsFiltered = pc.minViewsFiltered;
      }
    }
  }
  return snapshot;
}

function readTank(userId: string): LastScoutSnapshot | null {
  const row = getPlatformDb()
    .prepare(`SELECT snapshot_json FROM scout_tanks WHERE user_id = ?`)
    .get(userId) as { snapshot_json: string } | undefined;
  if (!row) return null;
  try {
    return parseScoutSnapshot(JSON.parse(row.snapshot_json) as unknown);
  } catch (err) {
    console.error("scoutCache parse failed:", err);
    return null;
  }
}

function writeTank(userId: string, snapshot: LastScoutSnapshot): void {
  const tenantId = ensureUserTenant(userId);
  getPlatformDb()
    .prepare(
      `INSERT INTO scout_tanks (user_id, tenant_id, saved_at, snapshot_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         tenant_id = excluded.tenant_id,
         saved_at = excluded.saved_at,
         snapshot_json = excluded.snapshot_json`,
    )
    .run(userId, tenantId, snapshot.savedAt, JSON.stringify(snapshot));
}

/** One user's tank, or null when they have never Scouted. */
export async function getLastScout(opts: {
  userId: string;
}): Promise<LastScoutSnapshot | null> {
  return readTank(requireUserId(opts.userId));
}

/** Every user with a tank (expire sweeps). */
export function listScoutTankUserIds(): string[] {
  const rows = getPlatformDb()
    .prepare(`SELECT user_id FROM scout_tanks ORDER BY user_id`)
    .all() as Array<{ user_id: string }>;
  return rows.map((r) => r.user_id);
}

/** Append `next` threads not already present by id (stable order: prev then new). */
export function mergeThreadsById(
  prev: ThreadCard[],
  next: ThreadCard[],
): ThreadCard[] {
  if (!next.length) return prev;
  const seen = new Set(prev.map((t) => t.id));
  const out = [...prev];
  for (const t of next) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

/**
 * Persist a successful Scout snapshot for one user.
 * Metadata (agenda/queries/message/…) is replaced; threads are merged by id
 * so successive Scout runs accumulate cool leads across reloads.
 */
export async function saveScoutCache(
  snapshot: LastScoutSnapshot,
  opts: { userId: string },
): Promise<LastScoutSnapshot> {
  const parsed = parseScoutSnapshot(snapshot);
  if (!parsed) {
    throw new Error("invalid scout snapshot");
  }
  const userId = requireUserId(opts.userId);
  const db = getPlatformDb();
  return db.transaction((): LastScoutSnapshot => {
    const prev = readTank(userId);
    const threads = parsed.threads.map((thread) => ({
      ...thread,
      scoutAgendaSet: Boolean(parsed.agenda),
    }));
    const previousThreads = (prev?.threads ?? []).map((thread) => ({
      ...thread,
      scoutAgendaSet:
        thread.scoutAgendaSet ??
        (thread.onAgenda === true && Boolean(prev?.agenda)),
    }));
    const previousById = new Map(
      previousThreads.map((thread, index) => [thread.id, index]),
    );
    for (const thread of threads) {
      const index = previousById.get(thread.id);
      if (index !== undefined) {
        previousThreads[index] = {
          ...previousThreads[index],
          scoutAgendaSet: thread.scoutAgendaSet,
        };
      }
    }
    const merged: LastScoutSnapshot = {
      ...parsed,
      threads: mergeThreadsById(previousThreads, threads),
    };
    writeTank(userId, merged);
    return merged;
  })();
}

/**
 * Remove threads by id from one user's tank. Soft-no-op when the tank is empty.
 */
export async function pruneThreadsFromScoutCache(
  threadIds: Iterable<string>,
  opts: { userId: string },
): Promise<LastScoutSnapshot | null> {
  const userId = requireUserId(opts.userId);
  const remove = new Set(
    [...threadIds].map((id) => id.trim()).filter(Boolean),
  );
  if (!remove.size) {
    return readTank(userId);
  }
  const db = getPlatformDb();
  return db.transaction((): LastScoutSnapshot | null => {
    const prev = readTank(userId);
    if (!prev) return null;
    const threads = prev.threads.filter((t) => !remove.has(t.id));
    if (threads.length === prev.threads.length) return prev;
    const next: LastScoutSnapshot = { ...prev, threads };
    writeTank(userId, next);
    return next;
  })();
}
