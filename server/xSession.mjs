/**
 * X session helpers — uses your own browser cookies (auth_token + ct0).
 * Personal tooling only; GraphQL query IDs can rotate when X ships a new web client.
 */

/** Public web-client bearer (same token the X website ships in JS). Not an API secret. */
export function getWebBearer() {
  return process.env.X_BEARER_TOKEN ||
    "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
}

/** Current web Viewer operation — override with X_VIEWER_QUERY_ID if X rotates it. */
export function getViewerQueryId() {
  return process.env.X_VIEWER_QUERY_ID || "u4ni7JqpqdAQxWQfkLsdUQ";
}

const BADGE_URL =
  "https://x.com/i/api/2/badge_count/badge_count.json?supports_ntab_urt=1";

export function getSessionFromEnv(env = process.env) {
  const authToken = (env.X_AUTH_TOKEN || "").trim();
  const ct0 = (env.X_CT0 || "").trim();
  return {
    authToken,
    ct0,
    configured: Boolean(authToken && ct0),
  };
}

export function buildSessionHeaders({ authToken, ct0 }) {
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

function viewerUrl() {
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

/**
 * Prove the session works (GraphQL Viewer → identity; badge_count fallback).
 * @returns {{ ok: true, user: object, method: string } | { ok: false, status: number, error: string, message?: string }}
 */
export async function verifySession(session = getSessionFromEnv()) {
  if (!session.configured) {
    return {
      ok: false,
      status: 0,
      error: "missing_credentials",
      message: "Set X_AUTH_TOKEN and X_CT0 in .env (see README).",
    };
  }

  const headers = buildSessionHeaders(session);

  try {
    const ac1 = new AbortController();
    const tm1 = setTimeout(() => ac1.abort(), 10000);
    const viewer = await fetch(viewerUrl(), { method: "GET", headers, redirect: "manual", signal: ac1.signal }).finally(() => clearTimeout(tm1));
    const viewerText = await viewer.text();

    if (viewer.ok) {
      try {
        const data = JSON.parse(viewerText);
        const result = data?.data?.viewer?.user_results?.result;
        const core = result?.core;
        const restId = result?.rest_id || result?.id;
        if (core?.screen_name) {
          return {
            ok: true,
            method: "graphql_viewer",
            user: {
              id: String(result.rest_id || decodeUserRestId(restId) || ""),
              screen_name: core.screen_name,
              name: core.name || core.screen_name,
              protected: Boolean(result?.privacy?.protected),
            },
          };
        }
      } catch {
        // fall through to badge_count
      }
    }

    // Auth-only fallback if Viewer queryId rotated
    const ac2 = new AbortController();
    const tm2 = setTimeout(() => ac2.abort(), 10000);
    const badge = await fetch(BADGE_URL, { method: "GET", headers, redirect: "manual", signal: ac2.signal }).finally(() => clearTimeout(tm2));
    const badgeText = await badge.text();
    if (badge.ok) {
      return {
        ok: false,
        status: viewer.status,
        error: "viewer_failed",
        message: "Session cookies work, but GraphQL Viewer failed. Update X_VIEWER_QUERY_ID for identity.",
      };
    }

    return {
      ok: false,
      status: viewer.status || badge.status,
      error: "verify_failed",
      message: summarizeFailure(viewer.status || badge.status, viewerText || badgeText),
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

function decodeUserRestId(id) {
  if (!id || typeof id !== "string") return "";
  // Relay id like VXNlcjoyOTM2OTk3Mzc0 → User:2936997374
  if (!id.startsWith("VXNlcjo")) return id;
  try {
    const decoded = Buffer.from(id, "base64").toString("utf8");
    const m = decoded.match(/^User:(\d+)$/);
    return m?.[1] || "";
  } catch {
    return "";
  }
}

function summarizeFailure(status, body) {
  if (status === 401 || status === 403) {
    return "Session rejected — re-copy auth_token and ct0 from a logged-in x.com tab.";
  }
  if (status === 429) {
    return "Rate limited by X — wait and retry.";
  }
  if (status >= 300 && status < 400) {
    return "Unexpected redirect — cookies may be incomplete or expired.";
  }
  if (body.includes("Could not authenticate") || body.includes("Not authorized")) {
    return "Not authorized — check auth_token / ct0.";
  }
  return `X session verify HTTP ${status}`;
}
