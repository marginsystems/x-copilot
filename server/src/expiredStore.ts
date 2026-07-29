/**
 * Local expired cool leads — auto-moved when tweet age ≥ 24h without
 * interact/dismiss. Persists to data/expired.json (gitignored).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeAuthorKey } from "./interactionStore.js";
import type { ThreadCard } from "./xSearch.js";

export type ExpiredThread = {
  threadId: string;
  author: string;
  authorKey: string;
  /** When we marked it expired. */
  at: string;
  createdAt?: string;
  url?: string;
  summary?: string;
  text?: string;
};

export const EXPIRED_MS = 24 * 60 * 60 * 1000;
export const MAX_EXPIRED_HISTORY = 200;
const MAX_TEXT_CHARS = 280;

export function defaultExpiredStorePath(): string {
  return resolve(process.cwd(), "data", "expired.json");
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

function parseCreatedAtMs(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Threads with parseable createdAt older than EXPIRED_MS, not in skipIds.
 */
export function selectStaleThreads(
  threads: ThreadCard[],
  nowMs: number = Date.now(),
  skipIds: Set<string> = new Set(),
  maxAgeMs: number = EXPIRED_MS,
): ThreadCard[] {
  const out: ThreadCard[] = [];
  for (const t of threads) {
    if (!t.id || skipIds.has(t.id)) continue;
    const created = parseCreatedAtMs(t.createdAt);
    if (created === null) continue;
    if (nowMs - created < maxAgeMs) continue;
    out.push(t);
  }
  return out;
}

type StoreFile = { expired: ExpiredThread[] };

function emptyStore(): StoreFile {
  return { expired: [] };
}

function parseStore(raw: string): StoreFile {
  try {
    const data = JSON.parse(raw) as { expired?: unknown };
    if (!Array.isArray(data.expired)) return emptyStore();
    const expired: ExpiredThread[] = [];
    for (const entry of data.expired) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const threadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
      const author = typeof row.author === "string" ? row.author.trim() : "";
      const at = typeof row.at === "string" ? row.at : "";
      if (!threadId || !author || !at) continue;
      const item: ExpiredThread = {
        threadId,
        author,
        authorKey: normalizeAuthorKey(
          typeof row.authorKey === "string" && row.authorKey
            ? row.authorKey
            : author,
        ),
        at,
      };
      const createdAt = optionalString(row.createdAt);
      const url = optionalString(row.url);
      const summary = optionalString(row.summary);
      const text = optionalString(row.text, MAX_TEXT_CHARS);
      if (createdAt) item.createdAt = createdAt;
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      expired.push(item);
    }
    return { expired };
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
    console.error("expiredStore read failed:", err);
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

export function trimExpiredHistory(
  expired: ExpiredThread[],
  max: number = MAX_EXPIRED_HISTORY,
): ExpiredThread[] {
  return [...expired]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

export async function markExpired(opts: {
  threadId: string;
  author: string;
  createdAt?: string;
  url?: string;
  summary?: string;
  text?: string;
  nowMs?: number;
  storePath?: string;
}): Promise<ExpiredThread> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const nowMs = opts.nowMs ?? Date.now();
  const path = opts.storePath ?? defaultExpiredStorePath();
  const next: ExpiredThread = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
  };
  const createdAt = optionalString(opts.createdAt);
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  if (createdAt) next.createdAt = createdAt;
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;

  return serialized(async () => {
    const store = await readStore(path);
    const without = store.expired.filter((d) => d.threadId !== threadId);
    without.push(next);
    const expired = trimExpiredHistory(without);
    await writeStore(path, { expired });
    return next;
  });
}

export async function listExpiredHistory(opts?: {
  storePath?: string;
  limit?: number;
}): Promise<ExpiredThread[]> {
  const path = opts?.storePath ?? defaultExpiredStorePath();
  const store = await readStore(path);
  return trimExpiredHistory(
    store.expired,
    opts?.limit ?? MAX_EXPIRED_HISTORY,
  );
}

export async function getExpiredThreadIds(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  const history = await listExpiredHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
