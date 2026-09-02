/**
 * Official X API v2 tweet → ThreadCard conversion.
 * Used by recent-search and tweet lookup. No HTTP client.
 */
import { MAX_OP_TEXT_CHARS, type ThreadCard } from "./threadCard.js";
import {
  entityUrlsHaveOutbound,
  hasCardUri,
  isXArticleUrl,
  mediaShortlinkKeys,
  textHasOutboundLink,
  type UrlEntity,
} from "./xLinks.js";

export type V2User = {
  id?: string;
  username?: string;
  name?: string;
};

export type V2Tweet = {
  id?: string;
  text?: string;
  author_id?: string;
  created_at?: string;
  conversation_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type?: string; id?: string }>;
  entities?: {
    urls?: Array<{
      url?: string;
      expanded_url?: string;
      display_url?: string;
    }>;
    media?: Array<{
      url?: string;
      expanded_url?: string;
      display_url?: string;
    }>;
  };
  note_tweet?: {
    text?: string;
    entity_set?: {
      urls?: UrlEntity[];
      media?: UrlEntity[];
    };
  };
  /** X Article metadata when `tweet.fields=article` is requested. */
  article?: unknown;
  /** Website / ads card. Landing URL is not in the v2 payload. */
  card_uri?: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
};

let v2AutomatedWarningLogged = false;

function screenNameKey(handle: string | undefined): string {
  return (handle ?? "").trim().replace(/^@+/, "").toLowerCase();
}

function includedTweetBody(tw: V2Tweet): string {
  return (tw.note_tweet?.text?.trim() || tw.text || "").trim();
}

function v2TweetHasOutboundLink(tweet: V2Tweet): boolean {
  if (hasCardUri(tweet.card_uri)) return true;
  if (entityUrlsHaveOutbound(tweet.entities?.urls)) return true;
  if (entityUrlsHaveOutbound(tweet.note_tweet?.entity_set?.urls)) return true;
  return textHasOutboundLink(includedTweetBody(tweet));
}

function v2UrlLooksLikeArticle(tweet: V2Tweet): boolean {
  for (const u of tweet.entities?.urls ?? []) {
    const expanded = (u.expanded_url ?? u.url ?? "").trim();
    if (expanded && isXArticleUrl(expanded)) return true;
  }
  return false;
}

/** Official v2 Article object, or an `/i/article/` entity URL. */
function v2TweetHasArticle(tweet: V2Tweet): boolean {
  if (tweet.article && typeof tweet.article === "object") return true;
  return v2UrlLooksLikeArticle(tweet);
}

function v2TweetLongform(tweet: V2Tweet): ThreadCard["longform"] {
  if (v2TweetHasArticle(tweet)) return "article";
  if (tweet.note_tweet?.text?.trim()) return "note_tweet";
  return undefined;
}

/**
 * Fill opAuthor/opText from search `includes.tweets` for replied_to parents.
 * Sets opParentDerived when hydrate can skip (direct reply, self-chain, or
 * nested with conversation root already in includes).
 */
function applyIncludedReplyOp(
  card: ThreadCard,
  tweet: V2Tweet,
  usersById: Map<string, V2User>,
  tweetsById: Map<string, V2Tweet>,
): void {
  const repliedToId = tweet.referenced_tweets?.find(
    (r) => r.type === "replied_to",
  )?.id;
  if (!repliedToId) return;

  const parentTw = tweetsById.get(repliedToId);
  const convId = tweet.conversation_id?.trim();
  const nested = Boolean(convId && convId !== repliedToId);
  const rootTw = nested && convId ? tweetsById.get(convId) : undefined;
  const replyKey = screenNameKey(card.author.replace(/^@/, ""));

  let opTw: V2Tweet | undefined = parentTw;
  let canSkipHydrate = false;

  if (parentTw) {
    const parentKey = screenNameKey(
      parentTw.author_id
        ? usersById.get(parentTw.author_id)?.username
        : undefined,
    );
    if (parentKey && parentKey === replyKey) {
      // Self-chain: hydrate stops on immediate parent.
      opTw = parentTw;
      canSkipHydrate = true;
    } else if (rootTw) {
      const rootKey = screenNameKey(
        rootTw.author_id ? usersById.get(rootTw.author_id)?.username : undefined,
      );
      if (rootKey && rootKey !== replyKey) {
        opTw = rootTw;
      }
      canSkipHydrate = true;
    } else if (!nested) {
      opTw = parentTw;
      canSkipHydrate = true;
    } else {
      // Nested, root missing from includes — provisional OP; let hydrate fetch root.
      opTw = parentTw;
      canSkipHydrate = false;
    }
  } else if (rootTw) {
    const rootKey = screenNameKey(
      rootTw.author_id ? usersById.get(rootTw.author_id)?.username : undefined,
    );
    if (rootKey && rootKey !== replyKey) {
      opTw = rootTw;
      canSkipHydrate = true;
    }
  } else {
    return;
  }

  const opText = opTw ? includedTweetBody(opTw) : "";
  const opUser = opTw?.author_id ? usersById.get(opTw.author_id) : undefined;
  const opHandle = opUser?.username?.trim();
  if (!opText || !opHandle) return;

  card.opAuthor = opHandle.startsWith("@") ? opHandle : `@${opHandle}`;
  card.opText = opText.slice(0, MAX_OP_TEXT_CHARS);
  card.opCharCount = opText.length;
  const opLongform = opTw ? v2TweetLongform(opTw) : undefined;
  if (opLongform) card.opLongform = opLongform;
  if (canSkipHydrate) card.opParentDerived = true;
  if (opTw && v2TweetHasOutboundLink(opTw)) card.hasOutboundLink = true;
  const opViews = opTw?.public_metrics?.impression_count;
  if (typeof opViews === "number" && Number.isFinite(opViews) && opViews >= 0) {
    card.opViews = opViews;
  }
}

/** Map a v2 tweet (+ includes) into our ThreadCard. */
export function v2TweetToCard(
  tweet: V2Tweet,
  usersById: Map<string, V2User>,
  tweetsById: Map<string, V2Tweet> = new Map(),
): ThreadCard | null {
  const id = tweet.id?.trim();
  const noteText = tweet.note_tweet?.text?.trim();
  const text = (noteText || tweet.text || "").trim();
  const authorUser = tweet.author_id
    ? usersById.get(tweet.author_id)
    : undefined;
  const handle = authorUser?.username?.trim();
  if (!id || !text || !handle) return null;

  const card: ThreadCard = {
    id,
    author: handle.startsWith("@") ? handle : `@${handle}`,
    text,
    url: `https://x.com/${handle.replace(/^@/, "")}/status/${id}`,
    createdAt: tweet.created_at,
  };
  const views = tweet.public_metrics?.impression_count;
  if (typeof views === "number" && Number.isFinite(views) && views >= 0) {
    card.views = views;
  }
  const longform = v2TweetLongform(tweet);
  if (longform) card.longform = longform;

  const repliedTo = tweet.referenced_tweets?.find((r) => r.type === "replied_to");
  if (repliedTo?.id) {
    card.inReplyToId = repliedTo.id;
    card.isReply = true;
  }
  if (tweet.in_reply_to_user_id) {
    const parentUser = usersById.get(tweet.in_reply_to_user_id);
    if (parentUser?.username) {
      card.inReplyToScreenName = parentUser.username.startsWith("@")
        ? parentUser.username
        : `@${parentUser.username}`;
    }
  }
  if (tweet.conversation_id) card.conversationId = tweet.conversation_id;

  const quoted = tweet.referenced_tweets?.find((r) => r.type === "quoted");
  if (quoted?.id) {
    card.isQuote = true;
    const qt = tweetsById.get(quoted.id);
    if (qt?.text && qt.author_id) {
      const qa = usersById.get(qt.author_id);
      if (qa?.username) {
        card.opAuthor = qa.username.startsWith("@")
          ? qa.username
          : `@${qa.username}`;
        card.opText = qt.text.slice(0, MAX_OP_TEXT_CHARS);
      }
      if (v2TweetHasOutboundLink(qt)) card.hasOutboundLink = true;
    }
  }

  // Prefer already-billed includes.tweets for reply OP so hydrate can skip.
  applyIncludedReplyOp(card, tweet, usersById, tweetsById);

  if (v2TweetHasOutboundLink(tweet)) card.hasOutboundLink = true;

  const mediaShortlinks = [...mediaShortlinkKeys(tweet.entities)];
  if (mediaShortlinks.length) card.mediaShortlinks = mediaShortlinks;

  if (!v2AutomatedWarningLogged) {
    v2AutomatedWarningLogged = true;
    console.warn(
      "[xSearch] v2 recent search does not expose X's Automated account badge — the dropAutomatedAccounts filter cannot drop automated accounts on this path.",
    );
  }

  return card;
}

export function parseV2SearchPayload(json: unknown): {
  threads: ThreadCard[];
  nextToken: string | null;
} {
  const root = json as {
    data?: V2Tweet[];
    includes?: { users?: V2User[]; tweets?: V2Tweet[] };
    meta?: { next_token?: string };
  };
  const usersById = new Map<string, V2User>();
  for (const u of root.includes?.users ?? []) {
    if (u.id) usersById.set(u.id, u);
  }
  const tweetsById = new Map<string, V2Tweet>();
  for (const t of root.includes?.tweets ?? []) {
    if (t.id) tweetsById.set(t.id, t);
  }
  const threads: ThreadCard[] = [];
  let dropped = 0;
  for (const tw of root.data ?? []) {
    const card = v2TweetToCard(tw, usersById, tweetsById);
    if (card) threads.push(card);
    else dropped += 1;
  }
  if (dropped > 0) {
    console.warn(
      `[xSearch] v2 recent search dropped ${dropped} result(s) with unresolvable id/text/author (suspended or withheld author missing from includes.users).`,
    );
  }
  return {
    threads,
    nextToken: root.meta?.next_token?.trim() || null,
  };
}
