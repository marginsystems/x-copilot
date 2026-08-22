/**
 * Local dismissals — "not interested" curated leads.
 * Persists to data/dismissals.json (gitignored). Soft-degrades on IO/parse errors.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getEverInteractedConversationIds } from "./interactionStore.js";
import {
  conversationIdsFromHistory,
  normalizeAuthorKey,
} from "./interactionCooldown.js";

export type Dismissal = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  url?: string;
  summary?: string;
  text?: string;
  reason?: string;
  /** X conversation root — blocks sibling replies on later Scouts. */
  conversationId?: string;
  /** Immediate parent status id when the dismissed card was a reply. */
  inReplyToId?: string;
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
      const conversationId = optionalString(row.conversationId);
      const inReplyToId = optionalString(row.inReplyToId);
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      if (reason) item.reason = reason;
      // Prefer explicit conversation root; fall back so ancestry still blocks.
      const root = conversationId || inReplyToId || null;
      if (root) item.conversationId = root;
      if (inReplyToId) item.inReplyToId = inReplyToId;
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
  conversationId?: string;
  inReplyToId?: string;
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
  const conversationId = optionalString(opts.conversationId);
  const inReplyToId = optionalString(opts.inReplyToId);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;
  if (reason) next.reason = reason;
  const root = conversationId || inReplyToId || null;
  if (root) next.conversationId = root;
  if (inReplyToId) next.inReplyToId = inReplyToId;

  return serialized(async () => {
    const store = await readStore(path);
    const prior = store.dismissals.find((d) => d.threadId === threadId);
    if (!next.conversationId && prior?.conversationId) {
      next.conversationId = prior.conversationId;
    }
    if (!next.inReplyToId && prior?.inReplyToId) {
      next.inReplyToId = prior.inReplyToId;
    }
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

/** Conversation / ancestry ids from durable Not interested history. */
export async function getDismissedConversationIds(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  const history = await listDismissalHistory({
    storePath: opts?.storePath,
    limit: MAX_DISMISSAL_HISTORY,
  });
  return conversationIdsFromHistory(history);
}

/**
 * Union of Marked + Not interested conversation ancestry for Scout filters.
 */
export async function getBlockedConversationIds(opts?: {
  interactionStorePath?: string;
  dismissalStorePath?: string;
}): Promise<Set<string>> {
  const [interacted, dismissed] = await Promise.all([
    getEverInteractedConversationIds({ storePath: opts?.interactionStorePath }),
    getDismissedConversationIds({ storePath: opts?.dismissalStorePath }),
  ]);
  if (!dismissed.size) return interacted;
  if (!interacted.size) return dismissed;
  return new Set([...interacted, ...dismissed]);
}

export async function getDismissedThreadIds(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  const history = await listDismissalHistory(opts);
  return new Set(history.map((d) => d.threadId).filter(Boolean));
}
