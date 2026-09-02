/**
 * Last Scout snapshot — in-memory + data/last-scout.json (gitignored).
 * Threads accumulate across runs (merge by id); other fields track the latest run.
 * Soft-degrades on IO/parse errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
  };
};

export function defaultScoutCachePath(): string {
  return resolve(process.cwd(), "data", "last-scout.json");
}

let memory: LastScoutSnapshot | null = null;
let writeLock: Promise<void> = Promise.resolve();

async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((resolveLock) => {
    release = resolveLock;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

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
    }
  }
  return snapshot;
}

async function readDisk(path: string): Promise<LastScoutSnapshot | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseScoutSnapshot(JSON.parse(raw) as unknown);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return null;
    console.error("scoutCache read failed:", err);
    return null;
  }
}

async function writeDisk(path: string, snapshot: LastScoutSnapshot): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

/** Load from memory, else disk into memory. */
export async function getLastScout(opts?: {
  storePath?: string;
}): Promise<LastScoutSnapshot | null> {
  if (memory) return memory;
  const path = opts?.storePath ?? defaultScoutCachePath();
  const fromDisk = await readDisk(path);
  if (fromDisk && !memory) memory = fromDisk;
  return memory;
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
 * Persist a successful Scout snapshot.
 * Metadata (agenda/queries/message/…) is replaced; threads are merged by id
 * so successive Scout runs accumulate cool leads across reloads.
 */
export async function saveScoutCache(
  snapshot: LastScoutSnapshot,
  opts?: { storePath?: string },
): Promise<LastScoutSnapshot> {
  const parsed = parseScoutSnapshot(snapshot);
  if (!parsed) {
    throw new Error("invalid scout snapshot");
  }
  const path = opts?.storePath ?? defaultScoutCachePath();
  return serialized(async () => {
    const prev = memory ?? (await readDisk(path));
    const threads = parsed.threads.map((thread) => ({
      ...thread,
      scoutAgendaSet: Boolean(parsed.agenda),
    }));
    const merged: LastScoutSnapshot = {
      ...parsed,
      threads: mergeThreadsById(prev?.threads ?? [], threads),
    };
    memory = merged;
    try {
      await writeDisk(path, merged);
    } catch (err) {
      console.error("scoutCache write failed:", err);
    }
    return merged;
  });
}

/**
 * Remove threads by id from the last-scout snapshot (in-memory + disk).
 * Soft-no-op when cache empty.
 */
export async function pruneThreadsFromScoutCache(
  threadIds: Iterable<string>,
  opts?: { storePath?: string },
): Promise<LastScoutSnapshot | null> {
  const remove = new Set(
    [...threadIds].map((id) => id.trim()).filter(Boolean),
  );
  if (!remove.size) {
    return getLastScout(opts);
  }
  const path = opts?.storePath ?? defaultScoutCachePath();
  return serialized(async () => {
    const prev = memory ?? (await readDisk(path));
    if (!prev) return null;
    const threads = prev.threads.filter((t) => !remove.has(t.id));
    if (threads.length === prev.threads.length) {
      memory = prev;
      return prev;
    }
    const next: LastScoutSnapshot = { ...prev, threads };
    try {
      await writeDisk(path, next);
      memory = next;
    } catch (err) {
      console.error("scoutCache prune failed:", err);
    }
    return next;
  });
}

/** Test helper — clear in-memory cache. */
export function clearScoutCacheMemory(): void {
  memory = null;
}
