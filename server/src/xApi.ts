/**
 * Official X API v2 client (app-only Bearer).
 * Replaces session-cookie GraphQL for read paths.
 */

import { countPostsRead, recordUsageEvent } from "./usageMeter.js";

export const X_API_BASE = "https://api.x.com/2";

export type XApiCreds = {
  bearerToken: string;
  configured: boolean;
  operatorUserId: string;
  operatorUsername: string;
};

export type XApiErrorBody = {
  title?: string;
  detail?: string;
  status?: number;
  type?: string;
};

export function getXApiCredsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): XApiCreds {
  const bearerToken = (env.X_API_BEARER_TOKEN ?? "").trim();
  return {
    bearerToken,
    configured: Boolean(bearerToken),
    operatorUserId: (env.X_OPERATOR_USER_ID ?? "").trim(),
    operatorUsername: (env.X_OPERATOR_USERNAME ?? "")
      .trim()
      .replace(/^@+/, ""),
  };
}

export function buildXApiHeaders(creds: XApiCreds): Record<string, string> {
  return {
    Authorization: `Bearer ${creds.bearerToken}`,
    Accept: "application/json",
    "User-Agent": "x-copilot/0.1 (official-api)",
  };
}

export type XApiGetResult =
  | { ok: true; status: number; json: unknown }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      json?: unknown;
    };

export async function xApiGet(opts: {
  path: string;
  query?: Record<string, string | undefined>;
  creds?: XApiCreds;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Skip usage ledger (tests / internal probes). */
  skipUsage?: boolean;
}): Promise<XApiGetResult> {
  const creds = opts.creds ?? getXApiCredsFromEnv();
  const pathForLog = opts.path.startsWith("http")
    ? new URL(opts.path).pathname
    : opts.path;

  const logUsage = (result: XApiGetResult, json?: unknown) => {
    if (opts.skipUsage) return;
    const postsRead =
      result.ok && json !== undefined
        ? countPostsRead(pathForLog, json)
        : 0;
    recordUsageEvent({
      method: "GET",
      path: pathForLog,
      status: result.status,
      error: result.ok ? undefined : result.error,
      postsRead,
    });
  };

  if (!creds.bearerToken?.trim()) {
    const result: XApiGetResult = {
      ok: false,
      status: 0,
      error: "missing_api_key",
      message: "Set X_API_BEARER_TOKEN in .env (Pay Per Use app bearer).",
    };
    logUsage(result);
    return result;
  }

  const url = new URL(
    opts.path.startsWith("http") ? opts.path : `${X_API_BASE}${opts.path}`,
  );
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  const ac = new AbortController();
  try {
    const tm = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20000);
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    let text: string;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: buildXApiHeaders(creds),
        signal: ac.signal,
      });
      text = await res.text();
    } finally {
      clearTimeout(tm);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      const result: XApiGetResult = {
        ok: false,
        status: res.status,
        error: "invalid_json",
        message: `X API returned non-JSON (HTTP ${res.status}).`,
      };
      logUsage(result);
      return result;
    }

    if (!res.ok) {
      const body = (json ?? {}) as XApiErrorBody;
      const detail = body.detail || body.title || text.slice(0, 240);
      let error = "x_api_http";
      if (res.status === 402) error = "credits_depleted";
      if (res.status === 401) error = "unauthorized";
      if (res.status === 429) error = "rate_limited";
      const result: XApiGetResult = {
        ok: false,
        status: res.status,
        error,
        message: `X API HTTP ${res.status}: ${detail}`,
        json,
      };
      logUsage(result);
      return result;
    }

    const result: XApiGetResult = { ok: true, status: res.status, json };
    logUsage(result, json);
    return result;
  } catch (err) {
    if (opts.signal?.aborted) {
      const result: XApiGetResult = {
        ok: false,
        status: 499,
        error: "client_disconnected",
        message: "Client disconnected",
      };
      logUsage(result);
      return result;
    }
    if (ac.signal.aborted) {
      const result: XApiGetResult = {
        ok: false,
        status: 504,
        error: "x_api_timeout",
        message: "X API request timed out",
      };
      logUsage(result);
      return result;
    }
    // Transport failure (DNS, connection refused, socket reset) — a retryable
    // 5xx, not a terminal 401. The endpoints map missing_credentials (status 0)
    // to 401 via `status || 401`, so status 0 here would mislabel a transient
    // network blip as bad credentials.
    const result: XApiGetResult = {
      ok: false,
      status: 502,
      error: "x_api_failed",
      message: err instanceof Error ? err.message : String(err),
    };
    logUsage(result);
    return result;
  }
}

/** Convert within_time-style window to RFC3339 start_time (UTC), clamped ≤7d. */
export function startTimeFromWithin(within: string): string {
  const t = within.trim().toLowerCase();
  const m = t.match(/^(\d+)\s*([hm])$/);
  let ms = 6 * 60 * 60 * 1000;
  if (m) {
    const n = Number(m[1]);
    if (m[2] === "h") ms = Math.min(n, 24 * 7) * 60 * 60 * 1000;
    else ms = Math.min(n, 60 * 24 * 7) * 60 * 1000;
  }
  // Recent search max lookback is 7 days.
  ms = Math.min(ms, 7 * 24 * 60 * 60 * 1000);
  return new Date(Date.now() - ms).toISOString();
}

/** Strip session-only within_time/since_time operators for v2 recent search. */
export function stripSessionTimeOps(query: string): {
  query: string;
  within?: string;
} {
  let q = query.trim();
  let within: string | undefined;
  const m = q.match(/\bwithin_time:(\d+[hm])\b/i);
  if (m) {
    within = m[1]!.toLowerCase();
    q = q.replace(/\s*\bwithin_time:\d+[hm]\b/gi, " ").trim();
  }
  q = q
    .replace(/\s*\bsince_time:\S+/gi, " ")
    .replace(/\s*\bsince:\S+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { query: q, within };
}
