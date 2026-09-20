/**
 * Hourly own-post discovery — one Latest `from:` search.
 * Replies go to the interaction store; every card also fills Analytics own_posts.
 */
import {
  MAX_INTERACTION_STORE,
  listInteractionHistory,
  markInteracted,
  type Interaction,
} from "./interactionStore.js";
import { access } from "node:fs/promises";
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { buildInteractionNotePath } from "../memory/knowledgeMemory.js";
import {
  projectConfirmedReplyMemory,
  type ConfirmedReplyMemoryState,
} from "../memory/interactionMemoryProjection.js";
import type { Embedder } from "../memory/memoryIndex.js";
import type { ThreadCard } from "../scout/threadCard.js";
import {
  searchTimelinePages,
  withSearchRecency,
  type SearchTimelineResult,
} from "../x-api/xSearch.js";
import { getXApiCredsFromEnv, type XApiCreds } from "../x-api/xApi.js";
import { getUserById, listIngestUsers } from "../auth/authStore.js";
import { findUserIdByXUsername } from "../auth/xIdentityStore.js";
import { resolveIngestHandle } from "../voice/userIngest.js";
import { dailyActivityUsage } from "../billing/billingQuotas.js";
import { ensureUserTenant } from "../billing/billingStore.js";
import {
  getWatchedThread,
  listConfirmedOwnReplies,
  upsertOwnPost,
} from "./ownPostStore.js";
import { recordDeskReplyMarked } from "./deskBeats.js";
import { recordMarkGamification } from "./gamification.js";
import { setGamificationSyncFailed } from "./interactionSync.js";
import { pruneConsumedScoutThread } from "../scout/scoutCache.js";
import {
  findUserIdByXUserId,
  lookupXUserId,
  resolveStoredXUserId,
} from "../x-api/xActivitySubscribe.js";
import type { OwnPostKind, ParsedPostCreate } from "../x-api/xActivity.js";

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

/** Latest own-posts query used by the hourly stats tick for the Analytics fold. */
export function buildOwnPostsQuery(
  screenName: string,
  withinTime = "24h",
): string {
  const name = normalizeScreenName(screenName);
  // Exclude retweets: they are someone else's post re-posted by the operator and
  // must not be folded into own_posts as originals (matches scoutCollect).
  return withSearchRecency(`from:${name} -is:retweet`, withinTime);
}

/** Latest own-replies query used by the hourly stats tick for the Interacted import. */
export function buildOwnRepliesQuery(
  screenName: string,
  withinTime = "24h",
): string {
  const name = normalizeScreenName(screenName);
  return withSearchRecency(`from:${name} is:reply`, withinTime);
}

export function ownPostKindFromCard(card: ThreadCard): OwnPostKind {
  if (card.isReply || card.inReplyToId) return "reply";
  if (card.isQuote) return "quote";
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
  const createdMs = card.createdAt ? Date.parse(card.createdAt) : NaN;
  return {
    eventUuid: `search:${card.id}`,
    xUserId: opts.xUserId,
    postId: card.id.trim(),
    kind: ownPostKindFromCard(card),
    text: card.text,
    postedAt: postedAtFromCard(card, opts.nowMs),
    postedAtFallback: !Number.isFinite(createdMs),
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
 * Fed by the own-posts search; the Interacted import runs its own `is:reply`
 * page. Soft-skips when no user/handle.
 */
export async function foldDiscoveredOwnPosts(opts: {
  threads: ThreadCard[];
  screenName: string;
  nowMs: number;
  resolveUserId?: (handle: string) => string | null;
  resolveXUserId?: (userId: string, handle: string) => Promise<string | null>;
}): Promise<number> {
  const handle = normalizeScreenName(opts.screenName);
  const matchedUserId = (opts.resolveUserId ?? findUserIdByXUsername)(handle);
  if (!matchedUserId) return 0;
  const resolveX =
    opts.resolveXUserId ??
    (async (id: string, name: string) =>
      resolveStoredXUserId(id) ?? (await lookupXUserId(name)));
  const xUserId = await resolveX(matchedUserId, handle);
  if (!xUserId) {
    console.warn(
      `[reply-discover] own_posts fold skipped screenName=${handle}: xUserId unresolvable (no stored X identity and username lookup failed)`,
    );
    return 0;
  }
  // Pin the fold to the desk user who actually owns this X identity (verified
  // X oauth / activity subscription), never the first user that merely claimed
  // the handle during onboarding — a claimed handle must not capture another
  // desk's Analytics or side-effect-create its tenant + billing rows.
  const userId = findUserIdByXUserId(xUserId) ?? matchedUserId;
  const user = getUserById(userId);
  const activity = dailyActivityUsage(userId, user?.email ?? null);
  if (!activity.can_watch) {
    console.warn(
      `[reply-discover] own_posts fold suppressed userId=${userId}: daily activity watch cap reached (${activity.used}/${activity.limit})`,
    );
    return 0;
  }
  const tenantId = ensureUserTenant(userId);
  let ingested = 0;
  // Hoist the daily count (already computed by dailyActivityUsage) and advance
  // it locally on new inserts instead of re-running a COUNT per card.
  let used = activity.used;
  for (const card of opts.threads) {
    const postId = card.id.trim();
    if (!postId) continue;
    if (used >= activity.limit) {
      console.warn(
        `[reply-discover] own_posts fold stopped at daily activity cap userId=${userId} (${used}/${activity.limit})`,
      );
      break;
    }
    // A card without a parseable createdAt is still folded: cardToOwnPostParsed
    // stamps discovery time and flags it as a fallback so the upsert stores it
    // without clobbering a real posted_at and corrects it on re-ingest.
    const isNew = upsertOwnPost({
      parsed: cardToOwnPostParsed(card, {
        xUserId,
        screenName: handle,
        nowMs: opts.nowMs,
      }),
      userId,
      tenantId,
    });
    if (isNew) {
      used += 1;
      ingested += 1;
    }
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

function canonicalNoteTime(row: { postedAt?: string; at: string }): string {
  return row.postedAt ?? row.at;
}

async function projectDiscoveredReply(opts: {
  userId: string;
  threadId: string;
  author: string;
  reply: string;
  url?: string;
  text?: string;
  opAuthor?: string;
  opText?: string;
  interactedAt: string;
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
  upsertMemory?: boolean;
}): Promise<ConfirmedReplyMemoryState> {
  const result = await projectConfirmedReplyMemory({
    userId: opts.userId,
    reply: opts.reply,
    threadId: opts.threadId,
    author: opts.author,
    source: "discovered",
    url: opts.url,
    text: opts.text,
    opAuthor: opts.opAuthor,
    opText: opts.opText,
    interactedAt: opts.interactedAt,
    knowledgeRoot: opts.knowledgeRoot,
    indexDir: opts.indexDir,
    embedder: opts.embedder,
    upsertMemory: opts.upsertMemory,
    awaitUpsert: opts.upsertMemory !== false,
  });
  if (result.state === "unavailable") {
    console.warn(
      `[reply-discover] knowledge write soft-fail threadId=${opts.threadId}`,
    );
  }
  return result.state;
}

function memorySeams(opts: {
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
  upsertMemory?: boolean;
}) {
  return {
    knowledgeRoot: opts.knowledgeRoot,
    indexDir: opts.indexDir,
    embedder: opts.embedder,
    upsertMemory: opts.upsertMemory,
  };
}

/** Fill missing notes from confirmed local own_posts — no extra X reads or XP. */
async function reconcileConfirmedOwnReplies(opts: {
  userId: string;
  history: Interaction[];
  skipReplyIds: Set<string>;
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
  upsertMemory?: boolean;
}): Promise<void> {
  let posts;
  try {
    posts = listConfirmedOwnReplies({ userId: opts.userId });
  } catch (err) {
    console.warn("[reply-discover] confirmed own_posts read soft-fail:", err);
    return;
  }
  if (posts.length === 0) return;

  const byReplyId = new Map<string, Interaction>();
  const byThreadId = new Map<string, Interaction>();
  for (const row of opts.history) {
    if (row.replyId) byReplyId.set(row.replyId, row);
    byThreadId.set(row.threadId, row);
  }

  for (const post of posts) {
    if (opts.skipReplyIds.has(post.id)) continue;
    const known =
      byReplyId.get(post.id) ??
      (post.inReplyToId
        ? byThreadId.get(post.inReplyToId)?.replyId === post.id
          ? byThreadId.get(post.inReplyToId)
          : undefined
        : undefined);
    if (!known) continue;
    try {
      await access(
        buildInteractionNotePath({
          threadId: known.threadId,
          interactedAt: canonicalNoteTime(known),
          knowledgeRoot: opts.knowledgeRoot,
        }),
      );
      continue;
    } catch {
      // Reconcile only notes that are still missing.
    }
    let watched = null;
    try {
      watched =
        getWatchedThread(opts.userId, known.threadId) ??
        (post.inReplyToId
          ? getWatchedThread(opts.userId, post.inReplyToId)
          : null) ??
        (post.conversationId
          ? getWatchedThread(opts.userId, post.conversationId)
          : null) ??
        (known.conversationId
          ? getWatchedThread(opts.userId, known.conversationId)
          : null);
    } catch (err) {
      console.warn(
        `[reply-discover] watch lookup soft-fail replyId=${post.id}:`,
        err,
      );
    }
    await projectDiscoveredReply({
      userId: opts.userId,
      threadId: known.threadId,
      author: known.author,
      reply: post.text,
      url:
        known.url ??
        watched?.url ??
        parentStatusUrl(known.author, known.threadId),
      text: known.text ?? watched?.text ?? undefined,
      interactedAt: canonicalNoteTime(known),
      ...memorySeams(opts),
    });
  }
}

/**
 * One Latest page of our own posts and one Latest page of our own replies
 * (~24h each). Writes replies into the interaction store and every own-post
 * card into own_posts (Analytics).
 */
export async function discoverOwnReplies(opts: {
  withinTime?: string;
  count?: number;
  maxPages?: number;
  nowMs?: number;
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
  /** When false, skip MiniLM upsert after note write (tests). Default true. */
  upsertMemory?: boolean;
  session?: XApiCreds;
  /** Desk user's handle. Required unless resolveScreenName is set. */
  screenName?: string;
  /** Desk user who owns the handle — every discovered row is theirs. */
  userId: string;
  /** Override the gamification ledger path (tests). */
  gamificationPath?: string;
  signal?: AbortSignal;
  searchTimelinePages?: SearchTimelinePagesFn;
  resolveScreenName?: () => Promise<string | null>;
  /** Override Analytics fold. Tests omit this so the platform DB is untouched. */
  foldOwnPosts?: FoldOwnPostsFn | null;
}): Promise<DiscoverRepliesResult> {
  const session = opts?.session ?? getXApiCredsFromEnv();
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
    if (opts?.screenName) {
      screenName = normalizeScreenName(opts.screenName);
    } else if (opts?.resolveScreenName) {
      screenName = await opts.resolveScreenName();
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
  const searchOpts = {
    product: "Latest" as const,
    count: opts?.count ?? 20,
    maxPages: opts?.maxPages ?? 1,
    signal: opts?.signal,
  };

  let result: SearchTimelineResult;
  try {
    result = await search({ query, ...searchOpts });
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

  let replyResult: SearchTimelineResult;
  try {
    replyResult = await search({
      query: buildOwnRepliesQuery(screenName, opts?.withinTime ?? "24h"),
      ...searchOpts,
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

  if (!replyResult.ok) {
    return {
      ok: false,
      screenName,
      searched: 0,
      discovered: 0,
      skipped: 0,
      error: replyResult.message || replyResult.error || "reply_search_failed",
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
        threads: [...result.threads, ...replyResult.threads],
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
    userId: opts.userId,
    limit: MAX_INTERACTION_STORE,
  });
  const { knownReplyIds, knownThreadIds } = indexKnownIds(history);
  const projectedReplyIds = new Set<string>();
  const seams = memorySeams(opts);
  let discovered = 0;
  let skipped = 0;

  for (const card of replyResult.threads) {
    const verdict = shouldImportDiscoveredReply({
      card,
      ownScreenName: screenName,
      knownReplyIds,
      knownThreadIds,
    });
    if (verdict !== "import") {
      if (verdict === "known_reply") {
        const known = history.find((row) => row.replyId === card.id.trim());
        if (known) {
          const projectionState = await projectDiscoveredReply({
            userId: opts.userId,
            threadId: known.threadId,
            author: known.author,
            reply: card.text,
            url: known.url ?? parentStatusUrl(known.author, known.threadId),
            text: card.opText,
            opAuthor: card.opAuthor,
            opText: card.opText,
            interactedAt: canonicalNoteTime(known),
            ...seams,
          });
          if (projectionState === "saved") projectedReplyIds.add(card.id.trim());
        }
      }
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
        userId: opts.userId,
        url: parentStatusUrl(author, threadId),
        text: card.opText,
        replyId,
        replyUrl: card.url,
        postedAt,
        conversationId: card.conversationId,
        inReplyToId: threadId,
        nowMs,
      });
      try {
        await pruneConsumedScoutThread(opts.userId, [
          interaction.threadId,
          interaction.conversationId,
          interaction.inReplyToId,
        ]);
      } catch (err) {
        console.warn(
          `[reply-discover] scout tank prune soft-fail replyId=${replyId}:`,
          err,
        );
      }
      knownReplyIds.add(replyId);
      knownThreadIds.add(threadId);
      discovered += 1;

      {
        try {
          const watched =
            getWatchedThread(opts.userId, threadId) ??
            (card.conversationId
              ? getWatchedThread(opts.userId, card.conversationId)
              : null);
          recordDeskReplyMarked({
            userId: opts.userId,
            source: watched ? "scout" : "organic",
            nowMs,
          });
        } catch (err) {
          console.warn(
            `[reply-discover] desk beats soft-fail replyId=${replyId}:`,
            err,
          );
        }
        try {
          await recordMarkGamification({
            threadId,
            userId: opts.userId,
            nowMs: Date.parse(interaction.at) || nowMs,
            gamificationPath: opts.gamificationPath,
          });
        } catch (err) {
          console.warn(
            `[reply-discover] streak mark soft-fail replyId=${replyId}:`,
            err,
          );
          await setGamificationSyncFailed({
            threadId,
            userId: opts.userId,
            checkpoint: "mark",
            failed: true,
            pendingAt: interaction.at,
          }).catch(() => {});
        }
      }

      const projectionState = await projectDiscoveredReply({
        userId: opts.userId,
        threadId,
        author,
        reply: card.text,
        url: interaction.url,
        text: card.opText,
        opAuthor: card.opAuthor,
        opText: card.opText,
        interactedAt: canonicalNoteTime(interaction),
        ...seams,
      });
      if (projectionState === "saved") projectedReplyIds.add(replyId);
    } catch (err) {
      skipped += 1;
      console.warn(
        `[reply-discover] upsert soft-fail replyId=${replyId}:`,
        err,
      );
    }
  }

  await reconcileConfirmedOwnReplies({
    userId: opts.userId,
    history,
    skipReplyIds: projectedReplyIds,
    ...seams,
  });

  return {
    ok: true,
    screenName,
    searched: replyResult.threads.length,
    discovered,
    skipped,
    ownPostsIngested,
  };
}

/** Hourly Analytics fold — one from: search per desk user with a handle. */
export async function discoverOwnRepliesForIngestUsers(opts?: {
  session?: XApiCreds;
  signal?: AbortSignal;
  /** Per-tick user budget (default 20, max 40) — mirrors ingestUsersHourly. */
  limit?: number;
}): Promise<DiscoverRepliesResult> {
  const users = listIngestUsers().slice(
    0,
    Math.min(opts?.limit ?? 20, 40),
  );
  const acc: DiscoverRepliesResult = {
    ok: true,
    searched: 0,
    discovered: 0,
    skipped: 0,
    ownPostsIngested: 0,
  };
  let ran = 0;
  let succeeded = 0;
  let lastError: string | undefined;
  for (const user of users) {
    const handle = resolveIngestHandle(user);
    if (!handle) continue;
    ran += 1;
    const result = await discoverOwnReplies({
      screenName: handle,
      userId: user.id,
      session: opts?.session,
      signal: opts?.signal,
    });
    acc.searched += result.searched;
    acc.discovered += result.discovered;
    acc.skipped += result.skipped;
    acc.ownPostsIngested =
      (acc.ownPostsIngested ?? 0) + (result.ownPostsIngested ?? 0);
    if (!result.ok) {
      console.warn(
        `[reply-discover] hourly soft-fail user=${user.id}: ${result.error ?? "unknown"}`,
      );
      lastError = result.error;
      continue;
    }
    succeeded += 1;
  }
  if (succeeded === 0 && ran > 0) {
    acc.ok = false;
    acc.error = lastError ?? "no_users_succeeded";
  }
  return acc;
}
