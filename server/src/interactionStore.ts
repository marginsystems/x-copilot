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
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { withFileLock } from "./fileLock.js";
import {
  conversationIdsFromHistory,
  normalizeAuthorKey,
  pruneExpired,
} from "./interactionCooldown.js";

export type InteractionSource = "manual" | "copy" | "discovered";

function normalizeInteractionSource(source: unknown): InteractionSource {
  if (source === "copy" || source === "discovered") return source;
  return "manual";
}

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
  /** Platform user who marked this thread — scopes voice folds to their own replies. */
  userId?: string;
  url?: string;
  summary?: string;
  text?: string;
  /** Our reply tweet rest id (from pasted reply URL). */
  replyId?: string;
  replyUrl?: string;
  /** When we consider the reply posted; defaults to `at`. */
  postedAt?: string;
  /**
   * X conversation root id (usually the OP status). Used to suppress the whole
   * thread after Mark — not just this reply's author.
   */
  conversationId?: string;
  /** Immediate parent status id when the marked card was a reply. */
  inReplyToId?: string;
  stats?: InteractionStats;
  /** True when the stats → memory note projection soft-failed; retried next tick. */
  memorySyncFailed?: boolean;
  /** True when the mark → gamification ledger projection soft-failed; retried next tick. */
  markGamificationSyncFailed?: boolean;
  /** True when the t24h bonus → gamification ledger projection soft-failed; retried next tick. */
  bonusGamificationSyncFailed?: boolean;
  /** Original mark `at` instances whose gamification projection is pending.
   * A list so a second soft-fail of a re-mark (which overwrites `at`) cannot
   * erase an earlier uncredited mark. */
  pendingMarkAts?: string[];
};

/** Interacted feed / default list cap (newest first). */
export const MAX_INTERACTION_HISTORY = 200;
/**
 * Durable retain for activity windows (28d / 12w). Larger than the feed cap so
 * `GET /api/interacted/stats` can bucket the full window before any count trim.
 */
export const MAX_INTERACTION_STORE = 2000;
const MAX_TEXT_CHARS = 280;

export function defaultStorePath(): string {
  return resolve(process.cwd(), "data", "interactions.json");
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

export type StoreFile = { interactions: Interaction[] };

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
      const source = normalizeInteractionSource(row.source);
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
      const conversationId = optionalString(row.conversationId);
      const inReplyToId = optionalString(row.inReplyToId);
      const userId = optionalString(row.userId);
      if (url) item.url = url;
      if (summary) item.summary = summary;
      if (text) item.text = text;
      if (replyId) item.replyId = replyId;
      if (replyUrl) item.replyUrl = replyUrl;
      if (postedAt) item.postedAt = postedAt;
      if (conversationId) item.conversationId = conversationId;
      if (inReplyToId) item.inReplyToId = inReplyToId;
      if (userId) item.userId = userId;
      if (row.stats && typeof row.stats === "object") {
        item.stats = row.stats as InteractionStats;
      }
      if (row.memorySyncFailed === true) {
        item.memorySyncFailed = true;
      }
      if (row.markGamificationSyncFailed === true) {
        item.markGamificationSyncFailed = true;
      }
      if (row.bonusGamificationSyncFailed === true) {
        item.bonusGamificationSyncFailed = true;
      }
      const pendingMarkAts = Array.isArray(row.pendingMarkAts)
        ? row.pendingMarkAts.filter(
            (s): s is string => typeof s === "string" && s.trim() !== "",
          )
        : [];
      // Legacy single-slot format written before the multi-pending change.
      const legacyPendingMarkAt = optionalString(row.pendingMarkAt);
      if (legacyPendingMarkAt && !pendingMarkAts.includes(legacyPendingMarkAt)) {
        pendingMarkAts.push(legacyPendingMarkAt);
      }
      if (pendingMarkAts.length) item.pendingMarkAts = pendingMarkAts;
      interactions.push(item);
    }
    return { interactions };
  } catch {
    return emptyStore();
  }
}

export async function readStore(path: string): Promise<StoreFile> {
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

export async function writeStore(path: string, store: StoreFile): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  // Atomic replace so unlocked readers never see a truncated JSON body.
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, path);
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
  userId?: string;
  url?: string;
  summary?: string;
  text?: string;
  replyId?: string;
  replyUrl?: string;
  postedAt?: string;
  conversationId?: string;
  inReplyToId?: string;
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
  const source = normalizeInteractionSource(opts.source);
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
  const conversationId = optionalString(opts.conversationId);
  const inReplyToId = optionalString(opts.inReplyToId);
  const userId = optionalString(opts.userId);
  if (url) next.url = url;
  if (summary) next.summary = summary;
  if (text) next.text = text;
  if (replyId) next.replyId = replyId;
  if (replyUrl) next.replyUrl = replyUrl;
  if (replyId || replyUrl) next.postedAt = postedAt;
  if (userId) next.userId = userId;
  // Prefer explicit conversation root; fall back so ancestry still blocks.
  const root =
    conversationId ||
    inReplyToId ||
    null;
  if (root) next.conversationId = root;
  if (inReplyToId) next.inReplyToId = inReplyToId;

  return withFileLock(path, async () => {
    const store = await readStore(path);
    const prior = store.interactions.find((i) => i.threadId === threadId);
    // Preserve existing stats snapshots across re-marks of the same thread.
    if (prior?.stats) next.stats = prior.stats;
    if (prior?.memorySyncFailed) next.memorySyncFailed = true;
    if (prior?.markGamificationSyncFailed) next.markGamificationSyncFailed = true;
    if (prior?.bonusGamificationSyncFailed) {
      next.bonusGamificationSyncFailed = true;
    }
    if (prior?.pendingMarkAts?.length) next.pendingMarkAts = prior.pendingMarkAts;
    if (!next.conversationId && prior?.conversationId) {
      next.conversationId = prior.conversationId;
    }
    if (!next.inReplyToId && prior?.inReplyToId) {
      next.inReplyToId = prior.inReplyToId;
    }
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
  /** Only rows marked by this platform user (voice folds). */
  userId?: string;
}): Promise<Interaction[]> {
  const path = opts?.storePath ?? defaultStorePath();
  const store = await readStore(path);
  const rows = opts?.userId
    ? store.interactions.filter((i) => i.userId === opts.userId)
    : store.interactions;
  return trimInteractionHistory(rows, opts?.limit ?? MAX_INTERACTION_HISTORY);
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

export async function getEverInteractedConversationIds(opts?: {
  storePath?: string;
}): Promise<Set<string>> {
  const history = await listInteractionHistory({
    storePath: opts?.storePath,
    limit: MAX_INTERACTION_STORE,
  });
  return conversationIdsFromHistory(history);
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
