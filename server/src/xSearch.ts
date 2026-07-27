/**
 * Session-backed X SearchTimeline client (read-only).
 * Query IDs rotate — set X_SEARCH_QUERY_ID or rely on heal + fallbacks.
 */
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
  /** Triage fields (filled by threadTriage after search). */
  summary?: string;
  /** 0–100, higher = more engagement bait / less worth replying to. */
  baitScore?: number;
  flags?: string[];
  intent?: string;
  engage?: "skip" | "consider" | "priority";
  reason?: string;
  /** Mirrors baitScore for the existing card meta line. */
  score?: number;
};

export type SearchProduct = "Latest" | "Top";

const DEFAULT_SEARCH_QUERY_IDS = [
  "kn0jeHGOUFYdNe_FUxwxsQ",
  "M1jEez78PEfVfbQLvlWMvQ",
  "QpNfg0kpPRfjROQ_9eOLXA",
];

let cachedSearchQueryId: string | null = null;

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

/** Parse SearchTimeline GraphQL JSON into thread cards (exported for tests). */
export function parseSearchTimelineResponse(data: unknown): ThreadCard[] {
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
  for (const instr of instructions) {
    const entries = instr.entries || instr.addEntries?.entries || [];
    for (const entry of entries) {
      const fromItem = entry.content?.itemContent?.tweet_results?.result;
      if (fromItem) {
        const card = tweetResultToCard(fromItem);
        if (card) cards.push(card);
      }
      for (const item of entry.content?.items || []) {
        const r = item.item?.itemContent?.tweet_results?.result;
        if (r) {
          const card = tweetResultToCard(r);
          if (card) cards.push(card);
        }
      }
    }
  }
  return cards;
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

type TweetResultNode = {
  __typename?: string;
  rest_id?: string;
  legacy?: {
    full_text?: string;
    created_at?: string;
    id_str?: string;
    user_id_str?: string;
    screen_name?: string;
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
      };
    };
  };
  /** X Articles / longform article payloads (shape varies by GraphQL build). */
  article?: unknown;
  article_results?: unknown;
  tweet?: unknown;
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

function tweetResultToCard(result: unknown): ThreadCard | null {
  const r = result as TweetResultNode;

  // TweetWithVisibilityResults wrapper
  const inner =
    r.__typename === "TweetWithVisibilityResults" && r.tweet
      ? (r.tweet as TweetResultNode)
      : r;

  const id = inner.rest_id || inner.legacy?.id_str;
  const noteText = noteTweetText(inner);
  const text = resolveCardText(inner.legacy?.full_text, noteText);
  const handle =
    inner.core?.user_results?.result?.core?.screen_name ||
    inner.core?.user_results?.result?.legacy?.screen_name ||
    inner.legacy?.screen_name;
  if (!id || !text || !handle) return null;

  const isArticle = hasArticlePayload(inner);
  const longform: ThreadCard["longform"] = isArticle
    ? "article"
    : noteText
      ? "note_tweet"
      : undefined;

  return {
    id: String(id),
    author: handle.startsWith("@") ? handle : `@${handle}`,
    text,
    url: `https://x.com/${handle.replace(/^@/, "")}/status/${id}`,
    createdAt: inner.legacy?.created_at,
    ...(longform ? { longform } : {}),
  };
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
  | { ok: true; threads: ThreadCard[]; queryId: string }
  | { ok: false; status: number; error: string; message: string };

export async function searchTimeline(opts: {
  query: string;
  product?: SearchProduct;
  count?: number;
  session?: SessionCreds;
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

  const query = opts.query.trim();
  if (!query) {
    return {
      ok: false,
      status: 400,
      error: "empty_query",
      message: "Search query is empty.",
    };
  }

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
    const qid =
      attempt < tryIds.length
        ? tryIds[attempt]
        : (await healSearchQueryId(session)) || tryIds[0];

    const variables = {
      rawQuery: query,
      count,
      querySource: "typed_query",
      product,
    };
    const params = new URLSearchParams({
      variables: JSON.stringify(variables),
    });
    const url = `https://x.com/i/api/graphql/${qid}/SearchTimeline?${params}`;

    let res: Response;
    try {
      const ac = new AbortController();
      const tm = setTimeout(() => ac.abort(), 15000);
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ features, queryId: qid }),
        signal: ac.signal,
      }).finally(() => clearTimeout(tm));
    } catch {
      continue;
    }
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
    const threads = parseSearchTimelineResponse(data);
    return { ok: true, threads, queryId: qid };
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

export async function searchMany(
  queries: string[],
  opts: {
    product?: SearchProduct;
    countPerQuery?: number;
    maxQueries?: number;
    delayMs?: number;
    session?: SessionCreds;
    /** 1-based index, total, query string — for Scout progress. */
    onQuery?: (index: number, total: number, query: string) => void;
  } = {},
): Promise<{
  queries: string[];
  threads: ThreadCard[];
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
    const result = await searchTimeline({
      query: cleaned[i],
      product: opts.product,
      count: opts.countPerQuery ?? 10,
      session: opts.session,
    });
    if (result.ok) {
      all.push(...result.threads);
    } else {
      errors.push({ query: cleaned[i], message: result.message });
    }
  }

  return {
    queries: cleaned,
    threads: dedupeThreads(all),
    errors,
  };
}
