/**
 * Official X API v2 recent-search client (read-only).
 */
import {
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
import { parseV2SearchPayload } from "./xV2Card.js";

export type SearchProduct = "Latest" | "Top";

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
    return "author_id,referenced_tweets.id,referenced_tweets.id.author_id,in_reply_to_user_id,attachments.media_keys";
  }
  return "author_id,in_reply_to_user_id,attachments.media_keys";
}

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
        "created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,entities,attachments,public_metrics,note_tweet,article,card_uri",
      expansions: searchExpansions(opts.expandReferenced !== false),
      "media.fields": "media_key,type,url,preview_image_url",
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
  /** Resume token from a previous call using this exact query and startTime. */
  cursor?: string;
  /** Stable v2 recent-search window shared with the incoming cursor. */
  startTime?: string;
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
  let cursor = opts.cursor?.trim() || undefined;
  let queryId = "";
  let pages = 0;
  // v2 recent search's next_token is bound to the exact query it was issued for,
  // so compute start_time once and reuse it on every page (identical params).
  const startTime =
    opts.startTime ??
    startTimeFromWithin(
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
