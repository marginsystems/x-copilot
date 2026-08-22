/**
 * Local skips — "pass on this thread" without dismissal memory.
 * Persists to data/skipped.json (gitignored). Soft-degrades on IO/parse errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeAuthorKey } from "./interactionCooldown.js";

export type Skip = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
};

export const MAX_SKIP_HISTORY = 200;
const MAX_TEXT_CHARS = 280;

export function defaultSkipStorePath(): string {
  return resolve(process.cwd(), "data", "skipped.json");
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

type StoreFile = { skipped: Skip[] };

function emptyStore(): StoreFile {
  return { skipped: [] };
}

function parseStore(raw: string): StoreFile {
  try {
    const data = JSON.parse(raw) as { skipped?: unknown };
    if (!Array.isArray(data.skipped)) return emptyStore();
    const skipped: Skip[] = [];
    for (const entry of data.skipped) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const threadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
      const author = typeof row.author === "string" ? row.author.trim() : "";
      const at = typeof row.at === "string" ? row.at : "";
      if (!threadId || !author || !at) continue;
      const item: Skip = {
        threadId,
        author,
        authorKey: normalizeAuthorKey(
          typeof row.authorKey === "string" && row.authorKey
            ? row.authorKey
            : author,
        ),
        at,
      };
      const url = optionalString(row.url);
      const summary = optionalString(row.summary);
      const text = optionalString(row.text, MAX_TEXT_CHARS);
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      skipped.push(item);
    }
    return { skipped };
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
    console.error("skipStore read failed:", err);
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

export function trimSkipHistory(
  skipped: Skip[],
  max: number = MAX_SKIP_HISTORY,
): Skip[] {
  return [...skipped]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

export async function markSkipped(opts: {
  threadId: string;
  author: string;
  url?: string;
  summary?: string;
  text?: string;
  nowMs?: number;
  storePath?: string;
}): Promise<Skip> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const nowMs = opts.nowMs ?? Date.now();
  const path = opts.storePath ?? defaultSkipStorePath();
  const next: Skip = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
  };
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;

  return serialized(async () => {
    const store = await readStore(path);
    const without = store.skipped.filter((d) => d.threadId !== threadId);
    without.push(next);
    const skipped = trimSkipHistory(without);
    await writeStore(path, { skipped });
    return next;
  });
}

export async function listSkipHistory(opts?: {
  storePath?: string;
  limit?: number;
}): Promise<Skip[]> {
  const path = opts?.storePath ?? defaultSkipStorePath();
  const store = await readStore(path);
  return trimSkipHistory(store.skipped, opts?.limit ?? MAX_SKIP_HISTORY);
}

export async function getSkippedThreadIds(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  const history = await listSkipHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
