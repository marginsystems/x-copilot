/**
 * Session-backed X SearchTimeline client (read-only).
 * Query IDs rotate — set X_SEARCH_QUERY_ID or rely on heal + fallbacks.
 */
import { normalizeTcoKey } from "./mediaText.js";
import {
  buildSessionHeaders,
  getSessionFromEnv,
  type SessionCreds,
} from "./xSession.js";

export type ThreadCard = {
  id: string;
  author: string;
  text: string;
  url: string;
  createdAt?: string;
  /**
   * Set when SearchTimeline exposed longform / Article payload.
   * Articles are hard-dropped before triage; note_tweet body feeds the char cap.
   */
  longform?: "note_tweet" | "article";
  /**
   * True when the candidate post has an outbound link (entities, card, or text).
   * Native media URLs do not count. Hard-dropped before triage.
   */
  hasOutboundLink?: boolean;
  /** t.co shortlink keys (lowercased `t.co/<code>`) that resolve to native media. */
  mediaShortlinks?: string[];
  /** Reply / conversation context for triage (OP scoring). */
  inReplyToId?: string;
  /** Screen name of the tweet being replied to (SearchTimeline legacy). */
  inReplyToScreenName?: string;
  conversationId?: string;
  isReply?: boolean;
  /** Parent or quoted root author/text when available. */
  opAuthor?: string;
  opText?: string;
  /** True when opAuthor/opText were filled from the reply parent by hydrateReplyParents. */
  opParentDerived?: boolean;
  /** Triage fields (filled by threadTriage after search). */
  summary?: string;
  /** 0–100, higher = more engagement bait / less worth replying to. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
  /** Closed preference category from triage (see THREAD_KINDS). */
  threadKind?: string;
  engage?: "skip" | "consider" | "priority";
  reason?: string;
  /** Mirrors baitScore for the existing card meta line. */
  score?: number;
};

const MAX_OP_TEXT_CHARS = 500;

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

export function dedupeThreads(threads: ThreadCard[]): ThreadCard[] {
  const seen = new Set<string>();
  const out: ThreadCard[] = [];
  for (const t of threads) {
    if (!t.id || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

type UrlEntity = {
  url?: string;
  expanded_url?: string;
  display_url?: string;
};

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
  card?: {
    rest_id?: string;
    legacy?: {
      name?: string;
      url?: string;
      binding_values?: Array<{
        key?: string;
        value?: {
          string_value?: string;
          scribe_key?: string;
        };
      }>;
    };
  };
  /** X Articles / longform article payloads (shape varies by GraphQL build). */
  article?: unknown;
  article_results?: unknown;
  tweet?: unknown;
  quoted_status_result?: { result?: unknown };
};

const NATIVE_MEDIA_HOST_RE =
  /(?:^|\.)(?:pic\.twitter\.com|pbs\.twimg\.com|video\.twimg\.com)(?:\/|$)/i;
/** e.g. https://twitter.com/<user>/status/<id>/photo/<n> or .../video/<n>. */
const TWITTER_MEDIA_PATH_RE =
  /^https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+\/(?:photo|video)\//i;
const OUTBOUND_URL_IN_TEXT_RE = /https?:\/\/[^\s]+|t\.co\/[A-Za-z0-9]+/gi;

/** True when URL is native X media (not an outbound link attachment). */
export function isNativeMediaUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  try {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(withScheme).hostname;
    return (
      NATIVE_MEDIA_HOST_RE.test(host) || TWITTER_MEDIA_PATH_RE.test(withScheme)
    );
  } catch {
    return NATIVE_MEDIA_HOST_RE.test(raw) || TWITTER_MEDIA_PATH_RE.test(raw);
  }
}

/** True when a URL string is an outbound (non-media) link. */
export function isOutboundLinkUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  if (!/^https?:\/\//i.test(raw) && !/^t\.co\//i.test(raw)) return false;
  return !isNativeMediaUrl(raw);
}

/** t.co shortlinks for native media: URLs expanded to media hosts, plus media-entity t.co keys. */
function mediaShortlinkKeys(
  ...entitySets: Array<
    { urls?: UrlEntity[]; media?: UrlEntity[] } | undefined
  >
): Set<string> {
  const keys = new Set<string>();
  for (const entities of entitySets) {
    if (!entities || typeof entities !== "object") continue;
    for (const u of entities.urls ?? []) {
      const expanded =
        typeof u.expanded_url === "string" ? u.expanded_url.trim() : "";
      if (!expanded || !isNativeMediaUrl(expanded)) continue;
      for (const c of [u.url, u.expanded_url, u.display_url]) {
        if (typeof c !== "string") continue;
        const key = normalizeTcoKey(c);
        if (key) keys.add(key);
      }
    }
    for (const m of entities.media ?? []) {
      for (const c of [m.url, m.expanded_url, m.display_url]) {
        if (typeof c !== "string") continue;
        const key = normalizeTcoKey(c);
        if (key) keys.add(key);
      }
    }
  }
  return keys;
}

/**
 * True when candidate text contains an outbound link (media excluded).
 * Bare t.co shortlinks are ambiguous (native media vs outbound) when their
 * entity is absent, so they never count here; outbound t.co links are resolved
 * via URL entities/cards instead.
 */
export function textHasOutboundLink(text: string): boolean {
  const matches = text.match(OUTBOUND_URL_IN_TEXT_RE);
  if (!matches) return false;
  for (const m of matches) {
    const cleaned = m.replace(/[),.!?;:]+$/g, "");
    if (normalizeTcoKey(cleaned)) continue;
    if (isOutboundLinkUrl(cleaned)) return true;
  }
  return false;
}

function entityUrlsHaveOutbound(urls: UrlEntity[] | undefined): boolean {
  if (!Array.isArray(urls)) return false;
  for (const u of urls) {
    // Prefer expanded_url so t.co → pic.twitter.com is treated as media.
    const expanded =
      typeof u.expanded_url === "string" ? u.expanded_url.trim() : "";
    if (expanded) {
      if (isNativeMediaUrl(expanded)) continue;
      if (isOutboundLinkUrl(expanded)) return true;
      continue;
    }
    for (const c of [u.url, u.display_url]) {
      if (typeof c === "string" && isOutboundLinkUrl(c)) return true;
    }
  }
  return false;
}

function cardHasOutboundLink(
  card: TweetResultNode["card"],
  ignoreShortlinks: Set<string>,
): boolean {
  if (!card || typeof card !== "object") return false;
  const legacy = card.legacy;
  if (!legacy) return false;
  if (typeof legacy.url === "string" && isOutboundLinkUrl(legacy.url)) {
    return true;
  }
  const bindings = legacy.binding_values;
  if (!Array.isArray(bindings)) return false;
  for (const b of bindings) {
    const key = (b.key ?? "").toLowerCase();
    const val = b.value?.string_value;
    if (typeof val !== "string" || !val.trim()) continue;
    if (
      key.includes("url") ||
      key === "card_url" ||
      key === "vanity_url" ||
      key === "website_url"
    ) {
      const tco = normalizeTcoKey(val);
      const isMediaShortlink = tco !== null && ignoreShortlinks.has(tco);
      if (!isMediaShortlink && isOutboundLinkUrl(val)) return true;
      if (textHasOutboundLink(val)) return true;
    }
  }
  return false;
}

/** Detect outbound links on a GraphQL tweet node (candidate only, not quoted OP). */
export function nodeHasOutboundLink(node: {
  legacy?: {
    full_text?: string;
    entities?: { urls?: UrlEntity[]; media?: UrlEntity[] };
  };
  card?: TweetResultNode["card"];
  note_tweet?: TweetResultNode["note_tweet"];
}): boolean {
  const legacyEntities = node.legacy?.entities;
  const noteEntities =
    node.note_tweet?.note_tweet_results?.result?.entity_set;
  const ignore = mediaShortlinkKeys(legacyEntities, noteEntities);
  if (entityUrlsHaveOutbound(legacyEntities?.urls)) return true;
  if (entityUrlsHaveOutbound(noteEntities?.urls)) return true;
  if (cardHasOutboundLink(node.card, ignore)) return true;
  const noteText = noteTweetText(node as TweetResultNode);
  const text = resolveCardText(node.legacy?.full_text, noteText);
  if (text && textHasOutboundLink(text)) return true;
  return false;
}

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

  const card: ThreadCard = {
    id: String(id),
    author: handle.startsWith("@") ? handle : `@${handle}`,
    text,
    url: `https://x.com/${handle.replace(/^@/, "")}/status/${id}`,
    createdAt: inner.legacy?.created_at,
    ...(longform ? { longform } : {}),
    ...(hasOutboundLink ? { hasOutboundLink: true } : {}),
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
  if (op.opAuthor) card.opAuthor = op.opAuthor;
  if (op.opText) card.opText = op.opText;
  return card;
}

async function healSearchQueryId(session: SessionCreds): Promise<string | null> {
  try {
    const headers = buildSessionHeaders(session);
    const page = await fetch("https://x.com/explore", {
      headers: {
        "user-agent": headers["user-agent"],
      },
    });
    const html = await page.text();
    const scripts = [
      ...html.matchAll(
        /https:\/\/abs\.twimg\.com\/responsive-web\/client-web[^"']+\.js/g,
      ),
    ].map((m) => m[0]);
    for (const src of [...new Set(scripts)].slice(0, 20)) {
      const js = await (await fetch(src)).text();
      if (!js.includes("SearchTimeline")) continue;
      const m =
        js.match(
          /queryId:"([A-Za-z0-9-_]+)"[^]{0,200}?operationName:"SearchTimeline"/,
        ) ||
        js.match(
          /operationName:"SearchTimeline"[^]{0,200}?queryId:"([A-Za-z0-9-_]+)"/,
        ) ||
        js.match(
          /e\.exports=\{queryId:"([^"]+)",operationName:"SearchTimeline"/,
        );
      if (m?.[1]) {
        cachedSearchQueryId = m[1];
        return m[1];
      }
    }
  } catch (err) {
    console.error("healSearchQueryId failed:", err);
  }
  return null;
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
  session?: SessionCreds;
  signal?: AbortSignal;
}): Promise<SearchTimelineResult> {
  const session = opts.session ?? getSessionFromEnv();
  if (!session.configured) {
    return {
      ok: false,
      status: 0,
      error: "missing_credentials",
      message: "Set X_AUTH_TOKEN and X_CT0 in .env.",
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
  const query =
    opts.applyRecency === false ? raw : withSearchRecency(raw);

  const count = Math.min(Math.max(opts.count ?? 10, 1), 20);
  const product = opts.product ?? "Latest";
  const features = searchFeatures();
  const headers = {
    ...buildSessionHeaders(session),
    "content-type": "application/json",
    referer: `https://x.com/search?q=${encodeURIComponent(query)}&src=typed_query&f=live`,
  };

  const tryIds = [
    getSearchQueryId(),
    ...DEFAULT_SEARCH_QUERY_IDS.filter((id) => id !== getSearchQueryId()),
  ];

  let lastStatus = 0;
  let lastBody = "";

  for (let attempt = 0; attempt < tryIds.length + 1; attempt++) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        status: 499,
        error: "client_disconnected",
        message: "Client disconnected",
      };
    }
    const qid =
      attempt < tryIds.length
        ? tryIds[attempt]
        : (await healSearchQueryId(session)) || tryIds[0];

    const variables: Record<string, unknown> = {
      rawQuery: query,
      count,
      querySource: "typed_query",
      product,
    };
    const cursor = opts.cursor?.trim();
    if (cursor) variables.cursor = cursor;

    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
    });
    const url = `https://x.com/i/api/graphql/${qid}/SearchTimeline?${params}`;

    let res: Response;
    let tm: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    try {
      const ac = new AbortController();
      tm = setTimeout(() => ac.abort(), 15000);
      onAbort = () => ac.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ features, queryId: qid }),
        signal: ac.signal,
      });
    } catch {
      clearTimeout(tm);
      if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
      continue;
    }
    clearTimeout(tm);
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    const text = await res.text();
    lastStatus = res.status;
    lastBody = text;

    if (res.status === 404 || text.includes("Query not found")) {
      continue;
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: "search_failed",
        message: `SearchTimeline HTTP ${res.status}`,
      };
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      return {
        ok: false,
        status: res.status,
        error: "invalid_json",
        message: "SearchTimeline returned non-JSON.",
      };
    }

    const errors = (data as { errors?: Array<{ message?: string }> }).errors;
    if (errors?.length) {
      const msg = errors.map((e) => e.message).join("; ");
      if (/query/i.test(msg)) continue;
      return {
        ok: false,
        status: 200,
        error: "graphql_error",
        message: msg,
      };
    }

    cachedSearchQueryId = qid;
    const page = parseSearchTimelinePage(data);
    return {
      ok: true,
      threads: page.threads,
      queryId: qid,
      bottomCursor: page.bottomCursor,
    };
  }

  return {
    ok: false,
    status: lastStatus,
    error: "search_failed",
    message:
      lastBody.slice(0, 200) ||
      `SearchTimeline failed after query-id attempts (HTTP ${lastStatus})`,
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
  session?: SessionCreds;
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
    session?: SessionCreds;
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
