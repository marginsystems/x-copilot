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
import { normalizeAuthorKey } from "./interactionCooldown.js";
import {
  writeInteractionMemory,
  normalizeReply,
} from "./knowledgeMemory.js";
import { upsertMemoryNote } from "./memoryIndex.js";
import type { ThreadCard } from "./threadCard.js";
import {
  searchTimelinePages,
  withSearchRecency,
  type SearchTimelineResult,
} from "./xSearch.js";
import { getXApiCredsFromEnv, type XApiCreds } from "./xApi.js";
import { getUserById, listIngestUsers } from "./authStore.js";
import { findUserIdByXUsername } from "./xIdentityStore.js";
import { resolveIngestHandle } from "./userIngest.js";
import { dailyActivityUsage, ensureUserTenant } from "./billingStore.js";
import { upsertOwnPost } from "./ownPostStore.js";
import {
  findUserIdByXUserId,
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
    // An unparseable createdAt must not be silently replaced with discovery
    // time: that wrong posted_at would permanently skew the day-series
    // bucketing, t1h/t24h sample scheduling, and the daily cap.
    if (!card.createdAt || !Number.isFinite(Date.parse(card.createdAt))) continue;
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
 * One Latest page of our own posts and one Latest page of our own replies
 * (~24h each). Writes replies into the interaction store and every own-post
 * card into own_posts (Analytics).
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
  session?: XApiCreds;
  /** Desk user's handle. Required unless resolveScreenName is set. */
  screenName?: string;
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
    storePath: opts?.storePath,
    limit: MAX_INTERACTION_STORE,
  });
  const { knownReplyIds, knownThreadIds } = indexKnownIds(history);
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
