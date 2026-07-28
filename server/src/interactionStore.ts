/**
 * Local interaction store — mark engaged threads, 24h author cooldown, and
 * durable history for the Interacted feed.
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
  url?: string;
  summary?: string;
  text?: string;
};

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const MAX_INTERACTION_HISTORY = 200;
const MAX_FILTERED_AUTHORS = 12;
const MAX_TEXT_CHARS = 280;

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

function optionalString(value: unknown, maxLen?: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  if (!t) return undefined;
  if (typeof maxLen === "number" && t.length > maxLen) {
    return t.slice(0, maxLen);
  }
  return t;
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
      const item: Interaction = {
        threadId,
        author,
        authorKey: normalizeAuthorKey(
          typeof row.authorKey === "string" && row.authorKey
            ? row.authorKey
            : author,
        ),
        at,
        source,
      };
      const url = optionalString(row.url);
      const summary = optionalString(row.summary);
      const text = optionalString(row.text, MAX_TEXT_CHARS);
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      interactions.push(item);
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
  writeLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  await prev;
  try {
    return await fn();
  } finally {
    release!();
  }
}

/** Newest-first, capped history (no 24h prune). */
export function trimInteractionHistory(
  interactions: Interaction[],
  max: number = MAX_INTERACTION_HISTORY,
): Interaction[] {
  return [...interactions]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

/** Upsert by threadId; keep durable history (cap); persist. */
export async function markInteracted(opts: {
  threadId: string;
  author: string;
  source?: InteractionSource;
  url?: string;
  summary?: string;
  text?: string;
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
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;

  return serialized(async () => {
    const store = await readStore(path);
    const without = store.interactions.filter((i) => i.threadId !== threadId);
    without.push(next);
    const interactions = trimInteractionHistory(without);
    await writeStore(path, { interactions });
    return next;
  });
}

/** Interactions still inside the 24h Scout cooldown window. */
export async function listActiveInteractions(opts?: {
  nowMs?: number;
  storePath?: string;
}): Promise<Interaction[]> {
  const nowMs = opts?.nowMs ?? Date.now();
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  return pruneExpired(store.interactions, nowMs);
}

/** Durable Interacted feed (newest first, capped). */
export async function listInteractionHistory(opts?: {
  storePath?: string;
  limit?: number;
}): Promise<Interaction[]> {
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  return trimInteractionHistory(
    store.interactions,
    opts?.limit ?? MAX_INTERACTION_HISTORY,
  );
}

export async function getCooledAuthorKeys(opts?: {
  nowMs?: number;
  storePath?: string;
}): Promise<Set<string>> {
  const active = await listActiveInteractions(opts);
  return new Set(active.map((i) => i.authorKey).filter(Boolean));
}
