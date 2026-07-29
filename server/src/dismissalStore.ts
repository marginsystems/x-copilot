/**
 * Local dismissals — "not interested" curated leads.
 * Persists to data/dismissals.json (gitignored). Soft-degrades on IO/parse errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { normalizeAuthorKey } from "./interactionStore.js";

export type Dismissal = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  reason?: string;
};

export const MAX_DISMISSAL_HISTORY = 200;
const MAX_TEXT_CHARS = 280;
const MAX_REASON_CHARS = 500;

export function defaultDismissalStorePath(): string {
  return resolve(process.cwd(), "data", "dismissals.json");
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

type StoreFile = { dismissals: Dismissal[] };

function emptyStore(): StoreFile {
  return { dismissals: [] };
}

function parseStore(raw: string): StoreFile {
  try {
    const data = JSON.parse(raw) as { dismissals?: unknown };
    if (!Array.isArray(data.dismissals)) return emptyStore();
    const dismissals: Dismissal[] = [];
    for (const entry of data.dismissals) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const threadId = typeof row.threadId === "string" ? row.threadId.trim() : "";
      const author = typeof row.author === "string" ? row.author.trim() : "";
      const at = typeof row.at === "string" ? row.at : "";
      if (!threadId || !author || !at) continue;
      const item: Dismissal = {
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
      const reason = optionalString(row.reason, MAX_REASON_CHARS);
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      if (reason) item.reason = reason;
      dismissals.push(item);
    }
    return { dismissals };
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
    console.error("dismissalStore read failed:", err);
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

export function trimDismissalHistory(
  dismissals: Dismissal[],
  max: number = MAX_DISMISSAL_HISTORY,
): Dismissal[] {
  return [...dismissals]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, max);
}

export async function markDismissed(opts: {
  threadId: string;
  author: string;
  url?: string;
  summary?: string;
  text?: string;
  reason?: string;
  nowMs?: number;
  storePath?: string;
}): Promise<Dismissal> {
  const threadId = opts.threadId.trim();
  const author = opts.author.trim();
  const authorKey = normalizeAuthorKey(author);
  if (!threadId || !author || !authorKey) {
    throw new Error("threadId and author are required");
  }
  const nowMs = opts.nowMs ?? Date.now();
  const path = opts.storePath ?? defaultDismissalStorePath();
  const next: Dismissal = {
    threadId,
    author,
    authorKey,
    at: new Date(nowMs).toISOString(),
  };
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  const reason = optionalString(opts.reason, MAX_REASON_CHARS);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;
  if (reason) next.reason = reason;

  return serialized(async () => {
    const store = await readStore(path);
    const without = store.dismissals.filter((d) => d.threadId !== threadId);
    without.push(next);
    const dismissals = trimDismissalHistory(without);
    await writeStore(path, { dismissals });
    return next;
  });
}

export async function listDismissalHistory(opts?: {
  storePath?: string;
  limit?: number;
}): Promise<Dismissal[]> {
  const path = opts?.storePath ?? defaultDismissalStorePath();
  const store = await readStore(path);
  return trimDismissalHistory(
    store.dismissals,
    opts?.limit ?? MAX_DISMISSAL_HISTORY,
  );
}

export async function getDismissedThreadIds(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  const history = await listDismissalHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
