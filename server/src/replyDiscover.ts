/**
 * Hourly own-post discovery — one Latest `from:` search.
 * Replies go to the interaction store; every card also fills Analytics own_posts.
 */
import {
  MAX_INTERACTION_STORE,
  listInteractionHistory,
  markInteracted,
  normalizeAuthorKey,
  type Interaction,
} from "./interactionStore.js";
import {
  writeInteractionMemory,
  normalizeReply,
} from "./knowledgeMemory.js";
import { upsertMemoryNote } from "./memoryIndex.js";
import {
  searchTimelinePages,
  withSearchRecency,
  type SearchTimelineResult,
  type ThreadCard,
} from "./xSearch.js";
import {
  getSessionFromEnv,
  verifySession,
  type SessionCreds,
} from "./xSession.js";
import { findUserIdByXUsername, getUserById } from "./authStore.js";
import { dailyActivityUsage, ensureUserTenant } from "./billingStore.js";
import {
  countOwnPostsSince,
  startOfUtcDayIso,
  upsertOwnPost,
} from "./ownPostStore.js";
import {
  lookupXUserId,
  resolveStoredXUserId,
} from "./xActivitySubscribe.js";
import type { OwnPostKind, ParsedPostCreate } from "./xActivity.js";

export type SearchTimelinePagesFn = (opts: {
  query: string;
  product?: "Latest" | "Top";
  count?: number;
  maxPages?: number;
  signal?: AbortSignal;
}) => Promise<SearchTimelineResult>;

export type DiscoverSkipReason =
  | "missing_parent"
  | "self_reply"
  | "known_reply"
  | "known_thread";

export type DiscoverRepliesResult = {
  ok: boolean;
  screenName?: string;
  searched: number;
  discovered: number;
  skipped: number;
  ownPostsIngested?: number;
  error?: string;
};

function normalizeScreenName(screenName: string): string {
  return screenName.trim().replace(/^@+/, "");
}

/** Latest own-posts query used by the hourly stats tick (Analytics + Interacted). */
export function buildOwnPostsQuery(
  screenName: string,
  withinTime = "24h",
): string {
  const name = normalizeScreenName(screenName);
  return withSearchRecency(`from:${name}`, withinTime);
}

/** Latest own-replies query. Prefer `buildOwnPostsQuery` for the hourly tick. */
export function buildOwnRepliesQuery(
  screenName: string,
  withinTime = "24h",
): string {
  const name = normalizeScreenName(screenName);
  return withSearchRecency(`from:${name} is:reply`, withinTime);
}

export function ownPostKindFromCard(card: ThreadCard): OwnPostKind {
  if (card.isReply || card.inReplyToId) return "reply";
  return "original";
}

export function postedAtFromCard(card: ThreadCard, nowMs: number): string {
  const createdMs = card.createdAt ? Date.parse(card.createdAt) : NaN;
  if (Number.isFinite(createdMs)) return new Date(createdMs).toISOString();
  return new Date(nowMs).toISOString();
}

export function cardToOwnPostParsed(
  card: ThreadCard,
  opts: { xUserId: string; screenName: string; nowMs: number },
): ParsedPostCreate {
  const handle = normalizeScreenName(opts.screenName);
  return {
    eventUuid: `search:${card.id}`,
    xUserId: opts.xUserId,
    postId: card.id.trim(),
    kind: ownPostKindFromCard(card),
    text: card.text,
    postedAt: postedAtFromCard(card, opts.nowMs),
    inReplyToId: card.inReplyToId?.trim() || null,
    inReplyToUserId: null,
    conversationId: card.conversationId?.trim() || null,
    authorUsername: handle,
    metrics: {},
  };
}

export type FoldOwnPostsFn = (opts: {
  threads: ThreadCard[];
  screenName: string;
  nowMs: number;
}) => Promise<number>;

/**
 * Write the hourly `from:` page into own_posts for the matching desk user.
 * Same search as Interacted — no second pull. Soft-skips when no user/handle.
 */
export async function foldDiscoveredOwnPosts(opts: {
  threads: ThreadCard[];
  screenName: string;
  nowMs: number;
  resolveUserId?: (handle: string) => string | null;
  resolveXUserId?: (userId: string, handle: string) => Promise<string | null>;
}): Promise<number> {
  const handle = normalizeScreenName(opts.screenName);
  const userId = (opts.resolveUserId ?? findUserIdByXUsername)(handle);
  if (!userId) return 0;
  const user = getUserById(userId);
  const activity = dailyActivityUsage(userId, user?.email ?? null);
  if (!activity.can_watch) return 0;
  const resolveX =
    opts.resolveXUserId ??
    (async (id: string, name: string) =>
      resolveStoredXUserId(id) ?? (await lookupXUserId(name)));
  const xUserId = await resolveX(userId, handle);
  if (!xUserId) return 0;
  const tenantId = ensureUserTenant(userId);
  let ingested = 0;
  for (const card of opts.threads) {
    const postId = card.id.trim();
    if (!postId) continue;
    if (countOwnPostsSince(userId, startOfUtcDayIso()) >= activity.limit) break;
    const isNew = upsertOwnPost({
      parsed: cardToOwnPostParsed(card, {
        xUserId,
        screenName: handle,
        nowMs: opts.nowMs,
      }),
      userId,
      tenantId,
    });
    if (isNew) ingested += 1;
  }
  return ingested;
}

export function shouldImportDiscoveredReply(opts: {
  card: ThreadCard;
  ownScreenName: string;
  knownReplyIds: Set<string>;
  knownThreadIds: Set<string>;
}): "import" | DiscoverSkipReason {
  const parentId = opts.card.inReplyToId?.trim();
  const parentAuthor = opts.card.inReplyToScreenName?.trim();
  if (!parentId || !parentAuthor) return "missing_parent";

  const ownKey = normalizeAuthorKey(opts.ownScreenName);
  const parentKey = normalizeAuthorKey(parentAuthor);
  if (ownKey && parentKey && ownKey === parentKey) return "self_reply";

  const replyId = opts.card.id.trim();
  if (replyId && opts.knownReplyIds.has(replyId)) return "known_reply";
  if (opts.knownThreadIds.has(parentId)) return "known_thread";
  return "import";
}

function parentStatusUrl(author: string, threadId: string): string {
  const screen = normalizeScreenName(author);
  return `https://x.com/${screen}/status/${threadId}`;
}

function indexKnownIds(history: Interaction[]): {
  knownReplyIds: Set<string>;
  knownThreadIds: Set<string>;
} {
  const knownReplyIds = new Set<string>();
  const knownThreadIds = new Set<string>();
  for (const row of history) {
    knownThreadIds.add(row.threadId);
    if (row.replyId) knownReplyIds.add(row.replyId);
  }
  return { knownReplyIds, knownThreadIds };
}

async function softWriteMemory(opts: {
  threadId: string;
  author: string;
  reply: string;
  url?: string;
  text?: string;
  opAuthor?: string;
  opText?: string;
  interactedAt: string;
  knowledgeRoot?: string;
  upsertMemory?: boolean;
}): Promise<void> {
  const reply = normalizeReply(opts.reply);
  if (!reply) return;
  try {
    const memory = await writeInteractionMemory({
      threadId: opts.threadId,
      author: opts.author,
      reply,
      source: "discovered",
      url: opts.url,
      text: opts.text,
      opAuthor: opts.opAuthor,
      opText: opts.opText,
      interactedAt: opts.interactedAt,
      knowledgeRoot: opts.knowledgeRoot,
    });
    if (opts.upsertMemory !== false) {
      await upsertMemoryNote(memory.path, { type: "interaction" }).catch(
        (err) => {
          console.warn(
            `[reply-discover] memory index soft-fail threadId=${opts.threadId}:`,
            err,
          );
        },
      );
    }
  } catch (err) {
    console.warn(
      `[reply-discover] knowledge write soft-fail threadId=${opts.threadId}:`,
      err,
    );
  }
}

/**
 * One Latest page of our own posts (~24h). Writes replies into the
 * interaction store and every card into own_posts (Analytics). One search.
 */
export async function discoverOwnReplies(opts?: {
  withinTime?: string;
  count?: number;
  maxPages?: number;
  nowMs?: number;
  storePath?: string;
  knowledgeRoot?: string;
  /** When false, skip MiniLM upsert after note write (tests). Default true. */
  upsertMemory?: boolean;
  session?: SessionCreds;
  signal?: AbortSignal;
  searchTimelinePages?: SearchTimelinePagesFn;
  resolveScreenName?: () => Promise<string | null>;
  /** Override Analytics fold. Tests omit this so the platform DB is untouched. */
  foldOwnPosts?: FoldOwnPostsFn | null;
}): Promise<DiscoverRepliesResult> {
  const session = opts?.session ?? getSessionFromEnv();
  if (!session.bearerToken) {
    return {
      ok: false,
      searched: 0,
      discovered: 0,
      skipped: 0,
      error: "missing_credentials",
    };
  }

  let screenName: string | null = null;
  try {
    if (opts?.resolveScreenName) {
      screenName = await opts.resolveScreenName();
    } else {
      const verified = await verifySession(session);
      if (
        verified.ok &&
        verified.user.screen_name &&
        verified.user.screen_name !== "unknown"
      ) {
        screenName = verified.user.screen_name;
      }
    }
  } catch (err) {
    return {
      ok: false,
      searched: 0,
      discovered: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!screenName) {
    return {
      ok: false,
      searched: 0,
      discovered: 0,
      skipped: 0,
      error: "screen_name_unresolved",
    };
  }

  const query = buildOwnPostsQuery(screenName, opts?.withinTime ?? "24h");
  const search = opts?.searchTimelinePages ?? searchTimelinePages;
  let result: SearchTimelineResult;
  try {
    result = await search({
      query,
      product: "Latest",
      count: opts?.count ?? 20,
      maxPages: opts?.maxPages ?? 1,
      signal: opts?.signal,
    });
  } catch (err) {
    return {
      ok: false,
      screenName,
      searched: 0,
      discovered: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  if (!result.ok) {
    return {
      ok: false,
      screenName,
      searched: 0,
      discovered: 0,
      skipped: 0,
      error: result.message || result.error || "search_failed",
    };
  }

  const nowMs = opts?.nowMs ?? Date.now();
  let ownPostsIngested = 0;
  const fold =
    opts?.foldOwnPosts === undefined
      ? process.env.NODE_TEST_CONTEXT
        ? null
        : foldDiscoveredOwnPosts
      : opts.foldOwnPosts;
  if (fold) {
    try {
      ownPostsIngested = await fold({
        threads: result.threads,
        screenName,
        nowMs,
      });
    } catch (err) {
      console.warn("[reply-discover] own_posts fold soft-fail:", err);
    }
  }

  // Dedupe against the full durable retain (not the 200-row feed cap) so an
  // older manual interaction cannot be silently overwritten by an upsert.
  const history = await listInteractionHistory({
    storePath: opts?.storePath,
    limit: MAX_INTERACTION_STORE,
  });
  const { knownReplyIds, knownThreadIds } = indexKnownIds(history);
  let discovered = 0;
  let skipped = 0;

  for (const card of result.threads) {
    const verdict = shouldImportDiscoveredReply({
      card,
      ownScreenName: screenName,
      knownReplyIds,
      knownThreadIds,
    });
    if (verdict !== "import") {
      skipped += 1;
      continue;
    }

    const threadId = card.inReplyToId!.trim();
    const author = card.inReplyToScreenName!.trim().startsWith("@")
      ? card.inReplyToScreenName!.trim()
      : `@${card.inReplyToScreenName!.trim()}`;
    const replyId = card.id.trim();
    const postedAt = postedAtFromCard(card, nowMs);
    if (card.createdAt && Number.isNaN(Date.parse(card.createdAt))) {
      console.warn(
        `[reply-discover] unparseable createdAt "${card.createdAt}" replyId=${replyId}; falling back to discovery time`,
      );
    }

    try {
      const interaction = await markInteracted({
        threadId,
        author,
        source: "discovered",
        url: parentStatusUrl(author, threadId),
        text: card.opText,
        replyId,
        replyUrl: card.url,
        postedAt,
        conversationId: card.conversationId,
        inReplyToId: threadId,
        nowMs,
        storePath: opts?.storePath,
      });
      knownReplyIds.add(replyId);
      knownThreadIds.add(threadId);
      discovered += 1;

      await softWriteMemory({
        threadId,
        author,
        reply: card.text,
        url: interaction.url,
        text: card.opText,
        opAuthor: card.opAuthor,
        opText: card.opText,
        interactedAt: interaction.postedAt ?? interaction.at,
        knowledgeRoot: opts?.knowledgeRoot,
        upsertMemory: opts?.upsertMemory,
      });
    } catch (err) {
      skipped += 1;
      console.warn(
        `[reply-discover] upsert soft-fail replyId=${replyId}:`,
        err,
      );
    }
  }

  return {
    ok: true,
    screenName,
    searched: result.threads.length,
    discovered,
    skipped,
    ownPostsIngested,
  };
}
