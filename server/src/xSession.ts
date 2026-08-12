/**
 * X credentials — official API bearer preferred; cookie GraphQL kept temporarily
 * for SearchTimeline / TweetResult until those paths migrate (stacked PRs).
 */

import { getXApiCredsFromEnv, xApiGet } from "./xApi.js";

export type SessionCreds = {
  /** App-only Pay Per Use bearer (preferred). */
  bearerToken: string;
  /** @deprecated session cookie — GraphQL search/lookup until migrated. */
  authToken: string;
  /** @deprecated session cookie — GraphQL search/lookup until migrated. */
  ct0: string;
  configured: boolean;
  operatorUserId: string;
  operatorUsername: string;
};

export type VerifyOk = {
  ok: true;
  method: string;
  user: {
    id: string;
    screen_name: string;
    name: string;
    protected: boolean;
  };
  warning?: string;
};

export type VerifyFail = {
  ok: false;
  status: number;
  error: string;
  message?: string;
};

export type VerifyResult = VerifyOk | VerifyFail;

/** Public web-client bearer (same token the X website ships in JS). Not an API secret. */
export function getWebBearer(): string {
  return (
    process.env.X_BEARER_TOKEN ||
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA"
  );
}

/** Current web Viewer operation — override with X_VIEWER_QUERY_ID if X rotates it. */
export function getViewerQueryId(): string {
  return process.env.X_VIEWER_QUERY_ID || "u4ni7JqpqdAQxWQfkLsdUQ";
}

const BADGE_URL =
  "https://x.com/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1";

export function getSessionFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SessionCreds {
  const api = getXApiCredsFromEnv(env);
  const authToken = (env.X_AUTH_TOKEN || "").trim();
  const ct0 = (env.X_CT0 || "").trim();
  const cookies = Boolean(authToken && ct0);
  return {
    bearerToken: api.bearerToken,
    authToken,
    ct0,
    configured: api.configured || cookies,
    operatorUserId: api.operatorUserId,
    operatorUsername: api.operatorUsername,
  };
}

/** Cookie GraphQL headers (legacy SearchTimeline / TweetResult). */
export function buildSessionHeaders({
  authToken,
  ct0,
}: Pick<SessionCreds, "authToken" | "ct0">): Record<string, string> {
  return {
    authorization: `Bearer ${getWebBearer()}`,
    cookie: `auth_token=${authToken}; ct0=${ct0}`,
    "x-csrf-token": ct0,
    "x-twitter-auth-type": "OAuth2Session",
    "x-twitter-active-user": "yes",
    "x-twitter-client-language": "en",
    origin: "https://x.com",
    referer: "https://x.com/home",
    accept: "*/*",
    "user-agent":
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  };
}

function viewerUrl(): string {
  const variables = { withCommunitiesMemberships: true };
  const features = {
    subscriptions_upsells_api_enabled: true,
    profile_label_improvements_pcf_label_in_post_enabled: false,
    rweb_tipjar_consumption_enabled: true,
    verified_phone_label_enabled: false,
    creator_subscriptions_tweet_preview_api_enabled: true,
    responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
    responsive_web_graphql_timeline_navigation_enabled: true,
  };
  const qs = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(features),
  });
  return `https://x.com/i/api/graphql/${getViewerQueryId()}/Viewer?${qs}`;
}

async function verifyViaApi(session: SessionCreds): Promise<VerifyResult> {
  const username = session.operatorUsername;
  const userId = session.operatorUserId;

  if (username) {
    const res = await xApiGet({
      path: `/users/by/username/${encodeURIComponent(username)}`,
      query: { "user.fields": "protected,name,username" },
      creds: session,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.error,
        message: res.message,
      };
    }
    const data = res.json as {
      data?: {
        id?: string;
        username?: string;
        name?: string;
        protected?: boolean;
      };
    };
    const u = data.data;
    if (!u?.id || !u.username) {
      return {
        ok: false,
        status: 503,
        error: "user_not_found",
        message: `No X user for username ${username}.`,
      };
    }
    return {
      ok: true,
      method: "api_users_by_username",
      user: {
        id: u.id,
        screen_name: u.username,
        name: u.name || u.username,
        protected: Boolean(u.protected),
      },
    };
  }

  if (userId) {
    const res = await xApiGet({
      path: `/users/${encodeURIComponent(userId)}`,
      query: { "user.fields": "protected,name,username" },
      creds: session,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: res.error,
        message: res.message,
      };
    }
    const data = res.json as {
      data?: {
        id?: string;
        username?: string;
        name?: string;
        protected?: boolean;
      };
    };
    const u = data.data;
    if (!u?.id || !u.username) {
      return {
        ok: false,
        status: 503,
        error: "user_not_found",
        message: `No X user for id ${userId}.`,
      };
    }
    return {
      ok: true,
      method: "api_users_by_id",
      user: {
        id: u.id,
        screen_name: u.username,
        name: u.name || u.username,
        protected: Boolean(u.protected),
      },
    };
  }

  const probe = await xApiGet({
    path: "/users/by/username/X",
    query: { "user.fields": "username" },
    creds: session,
  });
  if (!probe.ok) {
    return {
      ok: false,
      status: probe.status,
      error: probe.error,
      message: probe.message,
    };
  }
  return {
    ok: true,
    method: "api_bearer_probe",
    user: {
      id: "",
      screen_name: "unknown",
      name: "unknown",
      protected: false,
    },
    warning:
      "Bearer works. Set X_OPERATOR_USERNAME (and optionally X_OPERATOR_USER_ID) for Mark detect / reply discover.",
  };
}

async function verifyViaCookies(session: SessionCreds): Promise<VerifyResult> {
  const headers = buildSessionHeaders(session);

  try {
    const ac1 = new AbortController();
    const tm1 = setTimeout(() => ac1.abort(), 10000);
    const viewer = await fetch(viewerUrl(), {
      method: "GET",
      headers,
      redirect: "manual",
      signal: ac1.signal,
    }).finally(() => clearTimeout(tm1));
    const viewerText = await viewer.text();

    if (viewer.ok) {
      try {
        const data = JSON.parse(viewerText) as {
          data?: {
            viewer?: {
              user_results?: {
                result?: {
                  rest_id?: string;
                  id?: string;
                  core?: { screen_name?: string; name?: string };
                  privacy?: { protected?: boolean };
                };
              };
            };
          };
        };
        const result = data?.data?.viewer?.user_results?.result;
        const core = result?.core;
        const restId = result?.rest_id || result?.id;
        if (result && core?.screen_name) {
          return {
            ok: true,
            method: "graphql_viewer",
            user: {
              id: String(result.rest_id || decodeUserRestId(restId) || ""),
              screen_name: core.screen_name,
              name: core.name || core.screen_name,
              protected: Boolean(result.privacy?.protected),
            },
          };
        }
      } catch {
        // fall through to badge_count
      }
    }

    const ac2 = new AbortController();
    const tm2 = setTimeout(() => ac2.abort(), 10000);
    const badge = await fetch(BADGE_URL, {
      method: "GET",
      headers,
      redirect: "manual",
      signal: ac2.signal,
    }).finally(() => clearTimeout(tm2));
    const badgeText = await badge.text();
    if (badge.ok) {
      return {
        ok: true,
        method: "badge_count",
        user: {
          id: "",
          screen_name: "unknown",
          name: "unknown",
          protected: false,
        },
        warning:
          "Session cookies work, but GraphQL Viewer failed. Update X_VIEWER_QUERY_ID for identity.",
      };
    }

    return {
      ok: false,
      status: viewer.status || badge.status,
      error: "verify_failed",
      message: summarizeFailure(
        viewer.status || badge.status,
        viewerText || badgeText,
      ),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: "verify_failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Operator identity never changes for the process lifetime; cache successful API lookups. */
let apiVerifyCache: { key: string; result: VerifyOk } | undefined;

/**
 * Prove credentials work. Prefers X_API_BEARER_TOKEN; falls back to cookies.
 */
export async function verifySession(
  session: SessionCreds = getSessionFromEnv(),
): Promise<VerifyResult> {
  if (!session.configured) {
    return {
      ok: false,
      status: 0,
      error: "missing_credentials",
      message:
        "Set X_API_BEARER_TOKEN in .env (Pay Per Use), or legacy X_AUTH_TOKEN + X_CT0.",
    };
  }

  if (session.bearerToken) {
    const key = [session.bearerToken, session.operatorUsername, session.operatorUserId].join("|");
    if (apiVerifyCache?.key === key) return apiVerifyCache.result;
    const result = await verifyViaApi(session);
    if (result.ok) apiVerifyCache = { key, result };
    return result;
  }
  return verifyViaCookies(session);
}

function decodeUserRestId(id: string | undefined): string {
  if (!id || typeof id !== "string") return "";
  if (!id.startsWith("VXNlcjo")) return id;
  try {
    const decoded = Buffer.from(id, "base64").toString("utf8");
    const m = decoded.match(/^User:(\d+)$/);
    return m?.[1] || "";
  } catch {
    return "";
  }
}

function summarizeFailure(status: number, body: string): string {
  if (status === 401 || status === 403) {
    return "Session rejected — re-copy auth_token and ct0 from a logged-in x.com tab.";
  }
  if (status === 429) {
    return "Rate limited by X — wait and retry.";
  }
  if (status >= 300 && status < 400) {
    return "Unexpected redirect — cookies may be incomplete or expired.";
  }
  if (
    body.includes("Could not authenticate") ||
    body.includes("Not authorized")
  ) {
    return "Not authorized — check auth_token / ct0.";
  }
  return `X session verify HTTP ${status}`;
}
