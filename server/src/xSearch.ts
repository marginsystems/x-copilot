/**
 * Official X API v2 recent-search client (read-only).
 * Keeps ThreadCard shape + GraphQL fixture parsers for unit tests.
 */
import {
  MAX_OP_TEXT_CHARS,
  dedupeThreads,
  type ThreadCard,
} from "./threadCard.js";
import {
  getXApiCredsFromEnv,
  startTimeFromWithin,
  stripSessionTimeOps,
  xApiGet,
  type XApiCreds,
} from "./xApi.js";
import {
  mediaShortlinkKeys,
  nodeHasOutboundLink,
  type LinkPreviewCard,
  type UrlEntity,
} from "./xLinks.js";
import { parseV2SearchPayload } from "./xV2Card.js";

export type { ThreadCard };
export type { V2Tweet, V2User } from "./xV2Card.js";
export { MAX_OP_TEXT_CHARS, dedupeThreads };
export { v2TweetToCard } from "./xV2Card.js";
export {
  isNativeMediaUrl,
  isOutboundLinkUrl,
  isXArticleUrl,
  nodeHasOutboundLink,
  textHasOutboundLink,
} from "./xLinks.js";

export type SearchProduct = "Latest" | "Top";

const DEFAULT_SEARCH_QUERY_IDS = [
  "kn0jeHGOUFYdNe_FUxwxsQ",
  "M1jEez78PEfVfbQLvlWMvQ",
  "QpNfg0kpPRfjROQ_9eOLXA",
];

/** Default Latest window; override with X_SEARCH_WITHIN_TIME (e.g. 3h, 12h). */
export const DEFAULT_SEARCH_WITHIN_TIME = "6h";
export const MAX_SEARCH_PAGES = 3;
const PAGE_DELAY_MS = 400;

/** Expanded mode keeps referenced-tweet objects: quoted-root OP context
 * (v2TweetToCard quote branch) has no hydrate fallback, so it must come with
 * the search. Reduced mode drops them so Scout is not billed for
 * includes.tweets parents it filters out; reply parents are covered by
 * hydrateReplyParents (but quoted-root OP context has no reduced-mode
 * fallback). */
export function searchExpansions(expandReferenced = true): string {
  if (expandReferenced) {
    return "author_id,referenced_tweets.id,referenced_tweets.id.author_id,in_reply_to_user_id";
  }
  return "author_id,in_reply_to_user_id";
}

let cachedSearchQueryId: string | null = null;

/**
 * Resolve `Nh` / `Nm` token for within_time.
 * Accepts 1–24 hours or 1–1440 minutes; invalid → 6h.
 */
export function resolveWithinTime(
  raw: string | undefined = process.env.X_SEARCH_WITHIN_TIME,
): string {
  const t = (raw ?? "").trim().toLowerCase();
  const m = t.match(/^(\d+)\s*([hm])$/);
  if (!m) return DEFAULT_SEARCH_WITHIN_TIME;
  const n = Number(m[1]);
  const unit = m[2];
  if (!Number.isInteger(n) || n < 1) return DEFAULT_SEARCH_WITHIN_TIME;
  if (unit === "h" && n <= 24) return `${n}h`;
  if (unit === "m" && n <= 1440) return `${n}m`;
  return DEFAULT_SEARCH_WITHIN_TIME;
}

/** Append within_time unless the query already has a time bound. */
export function withSearchRecency(
  query: string,
  within: string = resolveWithinTime(),
): string {
  const q = query.trim();
  if (!q) return q;
  if (/\b(within_time|since_time|since):/i.test(q)) return q;
  return `${q} within_time:${within}`;
}

export function getSearchQueryId(): string {
  return (
    process.env.X_SEARCH_QUERY_ID?.trim() ||
    cachedSearchQueryId ||
    DEFAULT_SEARCH_QUERY_IDS[0]
  );
}

export function searchFeatures(): Record<string, boolean> {
  return {
    rweb_video_screen_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: true,
    responsive_web_profile_redirect_enabled: true,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_timeline_navigation_enabled: true,
    responsive_web_graphql_exclude_directive_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    premium_content_api_read_enabled: false,
    communities_web_enable_tweet_community_results_fetch: true,
    c9s_tweet_anatomy_moderator_badge_enabled: true,
    responsive_web_grok_analyze_button_fetch_trends_enabled: false,
    responsive_web_grok_analyze_post_followups_enabled: false,
    responsive_web_grok_annotations_enabled: false,
    responsive_web_jetfuel_frame: true,
    post_ctas_fetch_enabled: true,
    responsive_web_grok_share_attachment_enabled: true,
    responsive_web_edit_tweet_api_enabled: true,
    graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
    view_counts_everywhere_api_enabled: true,
    longform_notetweets_consumption_enabled: true,
    responsive_web_twitter_article_tweet_consumption_enabled: true,
    tweet_awards_web_tipping_enabled: false,
    responsive_web_grok_show_grok_translated_post: false,
    responsive_web_grok_analysis_button_from_backend: true,
    creator_subscriptions_quote_tweet_preview_enabled: false,
    freedom_of_speech_not_reach_fetch_enabled: true,
    standardized_nudges_misinfo: true,
    tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
    rweb_video_timestamps_enabled: true,
    longform_notetweets_rich_text_read_enabled: true,
    longform_notetweets_inline_media_enabled: true,
    responsive_web_grok_image_annotation_enabled: true,
    responsive_web_grok_imagine_annotation_enabled: true,
    responsive_web_grok_community_note_auto_translation_is_enabled: false,
    articles_preview_enabled: true,
    responsive_web_enhance_cards_enabled: false,
  };
}

type TimelineInstruction = {
  entries?: TimelineEntry[];
  addEntries?: { entries?: TimelineEntry[] };
};

type TimelineEntry = {
  entryId?: string;
  content?: {
    __typename?: string;
    cursorType?: string;
    value?: string;
    itemContent?: {
      tweet_results?: { result?: unknown };
    };
    items?: Array<{
      item?: {
        itemContent?: {
          tweet_results?: { result?: unknown };
        };
      };
    }>;
  };
};

export type SearchTimelinePage = {
  threads: ThreadCard[];
  bottomCursor: string | null;
};

/** Parse one SearchTimeline page: tweets + Bottom cursor for pagination. */
export function parseSearchTimelinePage(data: unknown): SearchTimelinePage {
  const root = data as {
    data?: {
      search_by_raw_query?: {
        search_timeline?: {
          timeline?: { instructions?: TimelineInstruction[] };
        };
      };
    };
  };
  const instructions =
    root?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions ||
    [];
  const cards: ThreadCard[] = [];
  let bottomCursor: string | null = null;
  for (const instr of instructions) {
    const entries = instr.entries || instr.addEntries?.entries || [];
    for (const entry of entries) {
      const content = entry.content;
      const typename = content?.__typename;
      const cursorType = content?.cursorType;
      const cursorValue =
        typeof content?.value === "string" ? content.value.trim() : "";
      const isBottom =
        typename === "TimelineTimelineCursor" &&
        (cursorType === "Bottom" ||
          /cursor-bottom/i.test(entry.entryId ?? ""));
      if (isBottom && cursorValue) {
        bottomCursor = cursorValue;
      }

      const fromItem = content?.itemContent?.tweet_results?.result;
      if (fromItem) {
        const card = tweetResultToCard(fromItem);
        if (card) cards.push(card);
      }
      for (const item of content?.items || []) {
        const r = item.item?.itemContent?.tweet_results?.result;
        if (r) {
          const card = tweetResultToCard(r);
          if (card) cards.push(card);
        }
      }
    }
  }
  return { threads: cards, bottomCursor };
}

/** Parse SearchTimeline GraphQL JSON into thread cards (exported for tests). */
export function parseSearchTimelineResponse(data: unknown): ThreadCard[] {
  return parseSearchTimelinePage(data).threads;
}

type TweetResultNode = {
  __typename?: string;
  rest_id?: string;
  legacy?: {
    full_text?: string;
    created_at?: string;
    id_str?: string;
    user_id_str?: string;
    screen_name?: string;
    conversation_id_str?: string;
    in_reply_to_status_id_str?: string;
    in_reply_to_screen_name?: string;
    entities?: {
      urls?: UrlEntity[];
      media?: UrlEntity[];
    };
  };
  core?: {
    user_results?: {
      result?: {
        core?: { screen_name?: string };
        legacy?: { screen_name?: string };
        affiliates_highlighted_label?: {
          label?: {
            description?: string;
            userLabelType?: string;
            longDescription?: { text?: string };
          };
        };
      };
    };
  };
  note_tweet?: {
    note_tweet_results?: {
      result?: {
        text?: string;
        entity_set?: {
          urls?: UrlEntity[];
          media?: UrlEntity[];
        };
      };
    };
  };
  /** Link-preview / summary card (shape varies by GraphQL build). */
  card?: LinkPreviewCard;
  /** X Articles / longform article payloads (shape varies by GraphQL build). */
  article?: unknown;
  article_results?: unknown;
  tweet?: unknown;
  quoted_status_result?: { result?: unknown };
};

function noteTweetText(node: TweetResultNode): string | undefined {
  const text = node.note_tweet?.note_tweet_results?.result?.text;
  if (typeof text !== "string") return undefined;
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function hasArticlePayload(node: TweetResultNode): boolean {
  if (typeof node.article === "object" && node.article !== null) return true;
  if (typeof node.article_results === "object" && node.article_results !== null) return true;
  return false;
}

function resolveCardText(
  fullText: string | undefined,
  noteText: string | undefined,
): string | undefined {
  const legacy = typeof fullText === "string" ? fullText.trim() : "";
  const note = noteText ?? "";
  if (!legacy && !note) return undefined;
  if (note.length > legacy.length) return note;
  if (legacy.length > 0) return legacy;
  return note;
}

function unwrapTweetNode(result: unknown): TweetResultNode | null {
  if (!result || typeof result !== "object") return null;
  const r = result as TweetResultNode;
  if (r.__typename === "TweetWithVisibilityResults" && r.tweet) {
    return r.tweet as TweetResultNode;
  }
  return r;
}

function screenNameFromNode(node: TweetResultNode): string | undefined {
  return (
    node.core?.user_results?.result?.core?.screen_name ||
    node.core?.user_results?.result?.legacy?.screen_name ||
    node.legacy?.screen_name
  );
}

/**
 * True when the tweet author carries X's Automated account badge.
 * Only `AutomatedLabel` — other affiliate badges must not match.
 */
export function userIsAutomated(result: unknown): boolean {
  const node = unwrapTweetNode(result);
  if (!node) return false;
  const label = node.core?.user_results?.result?.affiliates_highlighted_label
    ?.label;
  if (!label) return false;
  if (label.userLabelType === "AutomatedLabel") return true;
  // Fallback only when GraphQL omits userLabelType but still sends the badge copy.
  return (
    !label.userLabelType &&
    label.description?.trim().toLowerCase() === "automated"
  );
}

/** Extract quoted / parent root author+text when GraphQL inlined it. */
export function extractOpContext(node: TweetResultNode): {
  opAuthor?: string;
  opText?: string;
} {
  const quoted = unwrapTweetNode(node.quoted_status_result?.result);
  if (!quoted) return {};
  const noteText = noteTweetText(quoted);
  const text = resolveCardText(quoted.legacy?.full_text, noteText);
  const handle = screenNameFromNode(quoted);
  if (!text || !handle) return {};
  return {
    opAuthor: handle.startsWith("@") ? handle : `@${handle}`,
    opText: text.slice(0, MAX_OP_TEXT_CHARS),
  };
}

/** Public parse of a GraphQL tweet result node into a ThreadCard. */
export function tweetResultToCard(result: unknown): ThreadCard | null {
  const inner = unwrapTweetNode(result);
  if (!inner) return null;

  const id = inner.rest_id || inner.legacy?.id_str;
  const noteText = noteTweetText(inner);
  const text = resolveCardText(inner.legacy?.full_text, noteText);
  const handle = screenNameFromNode(inner);
  if (!id || !text || !handle) return null;

  const isArticle = hasArticlePayload(inner);
  const longform: ThreadCard["longform"] = isArticle
    ? "article"
    : noteText
      ? "note_tweet"
      : undefined;

  const inReplyToId = inner.legacy?.in_reply_to_status_id_str?.trim();
  const inReplyToScreenName =
    inner.legacy?.in_reply_to_screen_name?.trim() || undefined;
  const conversationId = inner.legacy?.conversation_id_str?.trim();
  const op = extractOpContext(inner);

  const hasOutboundLink = nodeHasOutboundLink(inner);
  const mediaShortlinks = [
    ...mediaShortlinkKeys(
      inner.legacy?.entities,
      inner.note_tweet?.note_tweet_results?.result?.entity_set,
    ),
  ];

  const isAutomated = userIsAutomated(inner);
  const card: ThreadCard = {
    id: String(id),
    author: handle.startsWith("@") ? handle : `@${handle}`,
    text,
    url: `https://x.com/${handle.replace(/^@/, "")}/status/${id}`,
    createdAt: inner.legacy?.created_at,
    ...(longform ? { longform } : {}),
    ...(hasOutboundLink ? { hasOutboundLink: true } : {}),
    ...(isAutomated ? { isAutomated: true } : {}),
    ...(mediaShortlinks.length ? { mediaShortlinks } : {}),
  };
  if (inReplyToId) {
    card.inReplyToId = inReplyToId;
    card.isReply = true;
  }
  if (inReplyToScreenName) {
    card.inReplyToScreenName = inReplyToScreenName.startsWith("@")
      ? inReplyToScreenName
      : `@${inReplyToScreenName}`;
  }
  if (conversationId) card.conversationId = conversationId;
  if (inner.quoted_status_result) card.isQuote = true;
  if (op.opAuthor) card.opAuthor = op.opAuthor;
  if (op.opText) card.opText = op.opText;
  return card;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type SearchTimelineResult =
  | {
      ok: true;
      threads: ThreadCard[];
      queryId: string;
      bottomCursor: string | null;
      pages?: number;
    }
  | { ok: false; status: number; error: string; message: string };

export async function searchTimeline(opts: {
  query: string;
  product?: SearchProduct;
  count?: number;
  cursor?: string;
  /** When false, skip within_time append (caller already applied). Default true. */
  applyRecency?: boolean;
  /** Stable v2 recent-search start_time shared across pagination pages. */
  startTime?: string;
  /** When false, do not bill includes.tweets parents. Default true. */
  expandReferenced?: boolean;
  session?: XApiCreds;
  signal?: AbortSignal;
}): Promise<SearchTimelineResult> {
  const session = opts.session ?? getXApiCredsFromEnv();
  if (!session.bearerToken) {
    return {
      ok: false,
      status: 0,
      error: "missing_credentials",
      message: "Set X_API_BEARER_TOKEN in .env (Pay Per Use app bearer).",
    };
  }

  const raw = opts.query.trim();
  if (!raw) {
    return {
      ok: false,
      status: 400,
      error: "empty_query",
      message: "Search query is empty.",
    };
  }
  const withRecency =
    opts.applyRecency === false ? raw : withSearchRecency(raw);
  const stripped = stripSessionTimeOps(withRecency);
  const query = stripped.query;
  if (!query) {
    return {
      ok: false,
      status: 400,
      error: "empty_query",
      message: "Search query is empty.",
    };
  }

  // v2 recent search requires max_results in [10, 100].
  const count = Math.min(Math.max(opts.count ?? 20, 10), 100);
  const product = opts.product ?? "Latest";
  const within = stripped.within ?? resolveWithinTime();
  const startTime = opts.startTime ?? startTimeFromWithin(within);

  const res = await xApiGet({
    path: "/tweets/search/recent",
    query: {
      query,
      max_results: String(count),
      start_time: startTime,
      sort_order: product === "Top" ? "relevancy" : "recency",
      "tweet.fields":
        "created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,entities,public_metrics,note_tweet,article",
      expansions: searchExpansions(opts.expandReferenced !== false),
      "user.fields": "username,name,protected",
      ...(opts.cursor?.trim() ? { next_token: opts.cursor.trim() } : {}),
    },
    creds: session,
    signal: opts.signal,
  });

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: res.error,
      message: res.message,
    };
  }

  const page = parseV2SearchPayload(res.json);
  return {
    ok: true,
    threads: page.threads,
    queryId: "v2/tweets/search/recent",
    bottomCursor: page.nextToken,
  };
}

/**
 * Latest search with recency + up to maxPages cursor pages (default 3).
 */
export async function searchTimelinePages(opts: {
  query: string;
  product?: SearchProduct;
  count?: number;
  maxPages?: number;
  pageDelayMs?: number;
  /** When false, do not bill includes.tweets parents. Default true. */
  expandReferenced?: boolean;
  session?: XApiCreds;
  signal?: AbortSignal;
  /** Injected for tests — same shape as searchTimeline. */
  fetchPage?: typeof searchTimeline;
}): Promise<SearchTimelineResult> {
  const maxPages = Math.min(
    Math.max(opts.maxPages ?? MAX_SEARCH_PAGES, 1),
    MAX_SEARCH_PAGES,
  );
  const query = withSearchRecency(opts.query.trim());
  if (!query) {
    return {
      ok: false,
      status: 400,
      error: "empty_query",
      message: "Search query is empty.",
    };
  }

  const fetchPage = opts.fetchPage ?? searchTimeline;
  const all: ThreadCard[] = [];
  let cursor: string | undefined;
  let queryId = "";
  let pages = 0;
  // v2 recent search's next_token is bound to the exact query it was issued for,
  // so compute start_time once and reuse it on every page (identical params).
  const startTime = startTimeFromWithin(
    stripSessionTimeOps(query).within ?? resolveWithinTime(),
  );

  for (let page = 0; page < maxPages; page++) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        status: 499,
        error: "client_disconnected",
        message: "Client disconnected",
      };
    }
    if (page > 0) await sleep(opts.pageDelayMs ?? PAGE_DELAY_MS);

    const result = await fetchPage({
      query,
      applyRecency: false,
      product: opts.product,
      count: opts.count ?? 20,
      cursor,
      startTime,
      expandReferenced: opts.expandReferenced,
      session: opts.session,
      signal: opts.signal,
    });

    if (!result.ok) {
      if (pages > 0) {
        return {
          ok: true,
          threads: dedupeThreads(all),
          queryId,
          bottomCursor: null,
          pages,
        };
      }
      return result;
    }

    pages += 1;
    queryId = result.queryId;
    all.push(...result.threads);

    if (!result.bottomCursor || result.threads.length === 0) {
      return {
        ok: true,
        threads: dedupeThreads(all),
        queryId,
        bottomCursor: null,
        pages,
      };
    }
    cursor = result.bottomCursor;
  }

  return {
    ok: true,
    threads: dedupeThreads(all),
    queryId,
    bottomCursor: cursor ?? null,
    pages,
  };
}

export async function searchMany(
  queries: string[],
  opts: {
    product?: SearchProduct;
    countPerQuery?: number;
    maxQueries?: number;
    maxPages?: number;
    delayMs?: number;
    session?: XApiCreds;
    signal?: AbortSignal;
    /** 1-based index, total, query string — for Scout progress. */
    onQuery?: (index: number, total: number, query: string) => void;
  } = {},
): Promise<{
  queries: string[];
  threads: ThreadCard[];
  /** Hits summed across queries before dedupe. */
  rawCount: number;
  errors: Array<{ query: string; message: string }>;
}> {
  const maxQueries = opts.maxQueries ?? 4;
  const cleaned = [
    ...new Set(queries.map((q) => q.trim()).filter(Boolean)),
  ].slice(0, maxQueries);
  const all: ThreadCard[] = [];
  const errors: Array<{ query: string; message: string }> = [];

  for (let i = 0; i < cleaned.length; i++) {
    if (i > 0) await sleep(opts.delayMs ?? 400);
    opts.onQuery?.(i + 1, cleaned.length, cleaned[i]);
    const result = await searchTimelinePages({
      query: cleaned[i],
      product: opts.product,
      count: opts.countPerQuery ?? 20,
      maxPages: opts.maxPages ?? MAX_SEARCH_PAGES,
      session: opts.session,
      signal: opts.signal,
    });
    if (result.ok) {
      all.push(...result.threads);
    } else {
      errors.push({ query: cleaned[i], message: result.message });
    }
  }

  return {
    queries: cleaned,
    rawCount: all.length,
    threads: dedupeThreads(all),
    errors,
  };
}
