/**
 * Local interaction store — mark engaged threads, 24h author cooldown, and
 * durable history for the Interacted feed.
 * Persists to data/interactions.json (gitignored). Soft-degrades on IO/parse errors.
 */
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  rmdir,
  stat,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { ThreadCard } from "./xSearch.js";

export type InteractionSource = "manual" | "copy";

export type ReplyStatSnapshot = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  sampledAt: string;
};

export type InteractionStats = {
  t1h?: ReplyStatSnapshot;
  t24h?: ReplyStatSnapshot;
};

export type Interaction = {
  threadId: string;
  author: string;
  authorKey: string;
  at: string;
  source: InteractionSource;
  url?: string;
  summary?: string;
  text?: string;
  /** Our reply tweet rest id (from pasted reply URL). */
  replyId?: string;
  replyUrl?: string;
  /** When we consider the reply posted; defaults to `at`. */
  postedAt?: string;
  stats?: InteractionStats;
  /** True when the stats → memory note projection soft-failed; retried next tick. */
  memorySyncFailed?: boolean;
};

/** Parse x.com / twitter.com status URL → numeric rest id. Keep in sync with src/App.tsx. */
export function parseStatusIdFromUrl(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "x.com" && host !== "twitter.com" && host !== "mobile.twitter.com") {
      return null;
    }
    const m = u.pathname.match(/\/status(?:es)?\/(\d+)/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

export const COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const STATS_T1H_MS = 60 * 60 * 1000;
export const STATS_T24H_MS = 24 * 60 * 60 * 1000;
/** Interacted feed / default list cap (newest first). */
export const MAX_INTERACTION_HISTORY = 200;
/**
 * Durable retain for activity windows (28d / 12w). Larger than the feed cap so
 * `GET /api/interacted/stats` can bucket the full window before any count trim.
 */
export const MAX_INTERACTION_STORE = 2000;
export const DEFAULT_STATS_TICK_CAP = 15;
const MAX_FILTERED_AUTHORS = 12;
const MAX_TEXT_CHARS = 280;

export type StatsCheckpoint = "t1h" | "t24h";

export type DueStatSample = {
  threadId: string;
  replyId: string;
  checkpoint: StatsCheckpoint;
  postedAt: string;
};

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
      const replyId = optionalString(row.replyId);
      const replyUrl = optionalString(row.replyUrl);
      const postedAt = optionalString(row.postedAt);
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      if (replyId) item.replyId = replyId;
      if (replyUrl) item.replyUrl = replyUrl;
      if (postedAt) item.postedAt = postedAt;
      if (row.stats && typeof row.stats === "object") {
        item.stats = row.stats as InteractionStats;
      }
      if (row.memorySyncFailed === true) {
        item.memorySyncFailed = true;
      }
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
  // Atomic replace so unlocked readers never see a truncated JSON body.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, path);
}

export async function withFileLock<T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const lockPath = filePath + ".lock";
  for (let retries = 0; ; retries++) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== "EEXIST") throw err;
      if (retries > 200)
        throw new Error("Could not acquire lock: " + filePath);
      // After ~1s, check if the lock dir is stale (crash orphan).
      if (retries > 50) {
        try {
          const s = await stat(lockPath);
          if (Date.now() - s.mtimeMs > 60000) {
            await rmdir(lockPath).catch(() => {});
            continue;
          }
        } catch {}
      }
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(lockPath).catch(() => {});
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
  replyId?: string;
  replyUrl?: string;
  postedAt?: string;
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
  const at = new Date(nowMs).toISOString();
  const next: Interaction = {
    threadId,
    author,
    authorKey,
    at,
    source,
  };
  const url = optionalString(opts.url);
  const summary = optionalString(opts.summary);
  const text = optionalString(opts.text, MAX_TEXT_CHARS);
  const replyId = optionalString(opts.replyId);
  const replyUrl = optionalString(opts.replyUrl);
  const postedAt = optionalString(opts.postedAt) ?? at;
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;
  if (replyId) next.replyId = replyId;
  if (replyUrl) next.replyUrl = replyUrl;
  if (replyId || replyUrl) next.postedAt = postedAt;

  return withFileLock(path, async () => {
    const store = await readStore(path);
    const prior = store.interactions.find((i) => i.threadId === threadId);
    // Preserve existing stats snapshots across re-marks of the same thread.
    if (prior?.stats) next.stats = prior.stats;
    if (prior?.memorySyncFailed) next.memorySyncFailed = true;
    const without = store.interactions.filter((i) => i.threadId !== threadId);
    without.push(next);
    // Retain enough history for the activity dashboard window; feed UI still
    // lists at MAX_INTERACTION_HISTORY via listInteractionHistory().
    const interactions = trimInteractionHistory(without, MAX_INTERACTION_STORE);
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

/** Authors from durable history (not pruned with the 24h window). */
export async function getEverInteractedAuthorKeys(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  // Scan the full durable retain (not the 200-row feed cap) so lifetime
  // account dedupe stays aligned with what the store actually keeps.
  const history = await listInteractionHistory({
    storePath: opts?.storePath,
    limit: MAX_INTERACTION_STORE,
  });
  return new Set(history.map((i) => i.authorKey).filter(Boolean));
}

/**
 * Author keys Scout should drop before triage.
 * Always includes 24h cooldown; when dedupeAccounts is on (default), also
 * lifetime keys from interaction history.
 */
export async function getAuthorKeysForScoutFilter(opts?: {
  dedupeAccounts?: boolean;
  nowMs?: number;
  storePath?: string;
}): Promise<Set<string>> {
  const cooled = await getCooledAuthorKeys(opts);
  if (opts?.dedupeAccounts === false) return cooled;
  const ever = await getEverInteractedAuthorKeys(opts);
  if (!ever.size) return cooled;
  return new Set([...cooled, ...ever]);
}

function postedAtMs(row: Interaction): number | null {
  if (!row.postedAt) return null;
  const t = Date.parse(row.postedAt);
  return Number.isFinite(t) ? t : null;
}

/**
 * Interactions due for a 1h or 24h reply-stats snapshot (oldest due first).
 * Skips rows without replyId. One checkpoint entry per due slot.
 */
export function selectDueStatSamples(
  interactions: Interaction[],
  nowMs: number = Date.now(),
  limit: number = DEFAULT_STATS_TICK_CAP,
): DueStatSample[] {
  const due: DueStatSample[] = [];
  for (const row of interactions) {
    const replyId = row.replyId?.trim();
    if (!replyId) continue;
    const posted = postedAtMs(row);
    if (posted === null) continue;
    const age = nowMs - posted;
    if (age < 0) continue;
    if (!row.stats?.t1h && age >= STATS_T1H_MS) {
      due.push({
        threadId: row.threadId,
        replyId,
        checkpoint: "t1h",
        postedAt: row.postedAt!,
      });
    }
    if (!row.stats?.t24h && age >= STATS_T24H_MS) {
      due.push({
        threadId: row.threadId,
        replyId,
        checkpoint: "t24h",
        postedAt: row.postedAt!,
      });
    }
  }
  // Prefer older posts first so late 24h samples don't starve behind fresh 1h.
  due.sort((a, b) => Date.parse(a.postedAt) - Date.parse(b.postedAt));
  return due.slice(0, Math.max(0, limit));
}

export async function listDueStatSamples(opts?: {
  nowMs?: number;
  storePath?: string;
  limit?: number;
}): Promise<DueStatSample[]> {
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  return selectDueStatSamples(
    store.interactions,
    opts?.nowMs ?? Date.now(),
    opts?.limit ?? DEFAULT_STATS_TICK_CAP,
  );
}

/** Merge a stats snapshot onto an interaction by threadId. */
export async function patchInteractionStats(opts: {
  threadId: string;
  checkpoint: StatsCheckpoint;
  snapshot: ReplyStatSnapshot;
  storePath?: string;
}): Promise<Interaction | null> {
  const threadId = opts.threadId.trim();
  if (!threadId) return null;
  const path = opts.storePath ?? defaultStorePath();

  return withFileLock(path, async () => {
    const store = await readStore(path);
    const idx = store.interactions.findIndex((i) => i.threadId === threadId);
    if (idx < 0) return null;
    const row = store.interactions[idx];
    const stats: InteractionStats = { ...(row.stats ?? {}) };
    stats[opts.checkpoint] = opts.snapshot;
    const next: Interaction = { ...row, stats };
    const interactions = [...store.interactions];
    interactions[idx] = next;
    await writeStore(path, { interactions });
    return next;
  });
}

/** Interactions whose stats → memory projection failed and should be retried. */
export async function listMemorySyncRetries(opts?: {
  storePath?: string;
  limit?: number;
}): Promise<Interaction[]> {
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  return store.interactions
    .filter((i) => i.memorySyncFailed)
    .slice(0, Math.max(0, opts?.limit ?? DEFAULT_STATS_TICK_CAP));
}

/** Record whether a stats → memory projection failed, so the next tick retries. */
export async function setMemorySyncFailed(opts: {
  threadId: string;
  failed: boolean;
  storePath?: string;
}): Promise<void> {
  const threadId = opts.threadId.trim();
  if (!threadId) return;
  const path = opts.storePath ?? defaultStorePath();
  await withFileLock(path, async () => {
    const store = await readStore(path);
    const idx = store.interactions.findIndex((i) => i.threadId === threadId);
    if (idx < 0) return;
    const row = store.interactions[idx]!;
    if (!!row.memorySyncFailed === opts.failed) return;
    const next: Interaction = { ...row };
    if (opts.failed) next.memorySyncFailed = true;
    else delete next.memorySyncFailed;
    const interactions = [...store.interactions];
    interactions[idx] = next;
    await writeStore(path, { interactions });
  });
}
