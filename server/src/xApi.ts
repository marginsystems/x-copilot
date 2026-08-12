/**
 * Official X API v2 client (app-only Bearer).
 * Replaces session-cookie GraphQL for read paths.
 */

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
}): Promise<XApiGetResult> {
  const creds = opts.creds ?? getXApiCredsFromEnv();
  if (!creds.bearerToken?.trim()) {
    return {
      ok: false,
      status: 0,
      error: "missing_api_key",
      message: "Set X_API_BEARER_TOKEN in .env (Pay Per Use app bearer).",
    };
  }

  const url = new URL(
    opts.path.startsWith("http") ? opts.path : `${X_API_BASE}${opts.path}`,
  );
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  try {
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), opts.timeoutMs ?? 20000);
    const onAbort = () => ac.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: buildXApiHeaders(creds),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(tm);
      opts.signal?.removeEventListener("abort", onAbort);
    }

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      return {
        ok: false,
        status: res.status,
        error: "invalid_json",
        message: `X API returned non-JSON (HTTP ${res.status}).`,
      };
    }

    if (!res.ok) {
      const body = (json ?? {}) as XApiErrorBody;
      const detail = body.detail || body.title || text.slice(0, 240);
      let error = "x_api_http";
      if (res.status === 402) error = "credits_depleted";
      if (res.status === 401) error = "unauthorized";
      if (res.status === 429) error = "rate_limited";
      return {
        ok: false,
        status: res.status,
        error,
        message: `X API HTTP ${res.status}: ${detail}`,
        json,
      };
    }

    return { ok: true, status: res.status, json };
  } catch (err) {
    if (opts.signal?.aborted) {
      return {
        ok: false,
        status: 499,
        error: "client_disconnected",
        message: "Client disconnected",
      };
    }
    return {
      ok: false,
      status: 0,
      error: "x_api_failed",
      message: err instanceof Error ? err.message : String(err),
    };
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
