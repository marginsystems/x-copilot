/**
 * Local interaction store — mark engaged threads and cool down authors for 24h.
 * Persists to data/interactions.json (gitignored). Soft-degrades on IO/parse errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ThreadCard } from "./xSearch.js";

export type InteractionSource = "manual" | "copy";

export type Interaction = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  source: InteractionSource;
};

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_FILTERED_AUTHORS = 12;

export function defaultStorePath(): string {
  return resolve(process.cwd(), "data", "interactions.json");
}

/** Normalize "@Foo " / "Foo" → "foo". */
export function normalizeAuthorKey(author: string): string {
  return author.trim().replace(/^@+/, "").toLowerCase();
}

export function isWithinCooldown(
  atIso: string,
  nowMs: number = Date.now(),
  windowMs: number = COOLDOWN_MS,
): boolean {
  const t = Date.parse(atIso);
  if (!Number.isFinite(t)) return false;
  const age = nowMs - t;
  return age >= 0 && age < windowMs;
}

export function pruneExpired(
  interactions: Interaction[],
  nowMs: number = Date.now(),
  windowMs: number = COOLDOWN_MS,
): Interaction[] {
  return interactions.filter((i) => isWithinCooldown(i.at, nowMs, windowMs));
}

export function filterThreadsByCooldown(
  threads: ThreadCard[],
  cooledKeys: Set<string>,
): {
  threads: ThreadCard[];
  filteredCount: number;
  filteredAuthors: string[];
} {
  if (!cooledKeys.size) {
    return { threads, filteredCount: 0, filteredAuthors: [] };
  }
  const kept: ThreadCard[] = [];
  const removedAuthors = new Set<string>();
  let filteredCount = 0;
  for (const thread of threads) {
    const key = normalizeAuthorKey(thread.author);
    if (key && cooledKeys.has(key)) {
      filteredCount += 1;
      removedAuthors.add(key);
      continue;
    }
    kept.push(thread);
  }
  return {
    threads: kept,
    filteredCount,
    filteredAuthors: [...removedAuthors].slice(0, MAX_FILTERED_AUTHORS),
  };
}

type StoreFile = { interactions: Interaction[] };

function emptyStore(): StoreFile {
  return { interactions: [] };
}

function parseStore(raw: string): StoreFile {
  try {
    const data = JSON.parse(raw) as { interactions?: unknown };
    if (!Array.isArray(data.interactions)) return emptyStore();
    const interactions: Interaction[] = [];
    for (const entry of data.interactions) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const threadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
      const author = typeof row.author === "string" ? row.author.trim() : "";
      const at = typeof row.at === "string" ? row.at : "";
      const source =
        row.source === "copy" || row.source === "manual" ? row.source : "manual";
      if (!threadId || !author || !at) continue;
      interactions.push({
        threadId,
        author,
        authorKey: normalizeAuthorKey(
          typeof row.authorKey === "string" && row.authorKey
            ? row.authorKey
            : author,
        ),
        at,
        source,
      });
    }
    return { interactions };
  } catch {
    return emptyStore();
  }
}

async function readStore(path: string): Promise<StoreFile> {
  try {
    const raw = await readFile(path, "utf8");
    return parseStore(raw);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return emptyStore();
    console.error("interactionStore read failed:", err);
    return emptyStore();
  }
}

async function writeStore(path: string, store: StoreFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

let writeLock: Promise<void> = Promise.resolve();

async function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const prev = writeLock;
  let release: () => void;
  writeLock = new Promise<void>((resolve) => { release = resolve; });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

/** Upsert by threadId; prune expired; persist. */
export async function markInteracted(opts: {
  threadId: string;
  author: string;
  source?: InteractionSource;
  nowMs?: number;
  storePath?: string;
}): Promise<Interaction> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const nowMs = opts.nowMs ?? Date.now();
  const path = opts.storePath ?? defaultStorePath();
  const source: InteractionSource = opts.source === "copy" ? "copy" : "manual";
  const next: Interaction = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
    source,
  };

  return serialized(async () => {
    const store = await readStore(path);
    const pruned = pruneExpired(store.interactions, nowMs).filter(
      (i) => i.threadId !== threadId,
    );
    pruned.push(next);
    await writeStore(path, { interactions: pruned });
    return next;
  });
}

export async function listActiveInteractions(opts?: {
  nowMs?: number;
  storePath?: string;
}): Promise<Interaction[]> {
  const nowMs = opts?.nowMs ?? Date.now();
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  return pruneExpired(store.interactions, nowMs);
}

export async function getCooledAuthorKeys(opts?: {
  nowMs?: number;
  storePath?: string;
}): Promise<Set<string>> {
  const active = await listActiveInteractions(opts);
  return new Set(active.map((i) => i.authorKey).filter(Boolean));
}
