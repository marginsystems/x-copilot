/**
 * Fire-and-forget client for the analytics sidecar (`analytics/`).
 * Never throws. Never blocks the request. Defaults to the loopback sidecar
 * unless ANALYTICS_DISABLE=1. Slack lives in the sidecar — this file only POSTs.
 *
 * Name union is duplicated from analytics/src/events.ts (no server ↔ analytics import).
 */
import type { AuthUser } from "./authStore.js";

export type AnalyticsEventName =
  | "user.signup"
  | "user.signin"
  | "scout.takeoff"
  | "scout.failed"
  | "mark.interacted"
  | "voice.suggest"
  | "desk.post";

const POST_TIMEOUT_MS = 800;

export type AnalyticsTrackInput = {
  name: AnalyticsEventName;
  userId?: string | null;
  email?: string | null;
  handle?: string | null;
  provider?: string | null;
  detail?: string | null;
  ok?: boolean;
};

export type TrackAnalyticsOpts = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function optionalString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Loopback sidecar. Overridable via ANALYTICS_URL / ANALYTICS_PORT. */
export function defaultAnalyticsUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const port = env.ANALYTICS_PORT?.trim() || "8788";
  return `http://127.0.0.1:${port}`;
}

export function analyticsClientEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.ANALYTICS_DISABLE !== "1";
}

export function analyticsBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.ANALYTICS_URL?.trim() || defaultAnalyticsUrl(env);
}

/**
 * POST /event and drop the promise. Failures are swallowed.
 */
export function trackAnalytics(
  event: AnalyticsTrackInput,
  opts: TrackAnalyticsOpts = {},
): void {
  try {
    if (!analyticsClientEnabled()) return;
    const base = analyticsBaseUrl();
    if (!base) return;
    const secret = process.env.ANALYTICS_SECRET?.trim();
    const body: Record<string, unknown> = {
      name: event.name,
      at: (opts.now ?? (() => new Date()))().toISOString(),
    };
    const userId = optionalString(event.userId);
    if (userId) body.userId = userId;
    const email = optionalString(event.email);
    if (email) body.email = email;
    const handle = optionalString(event.handle)?.replace(/^@+/, "");
    if (handle) body.handle = handle;
    const provider = optionalString(event.provider);
    if (provider) body.provider = provider;
    const detail = optionalString(event.detail);
    if (detail) body.detail = detail;
    if (typeof event.ok === "boolean") body.ok = event.ok;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const fetchImpl = opts.fetchImpl ?? fetch;
    const url = `${base.replace(/\/$/, "")}/event`;
    void fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    }).catch(() => {});
  } catch {
    // Client must never affect signup, sign-in, or takeoff.
  }
}

export function trackAuthAnalytics(
  user: AuthUser,
  created: boolean,
  provider: "google" | "x",
  opts?: TrackAnalyticsOpts,
): void {
  trackAnalytics(
    {
      name: created ? "user.signup" : "user.signin",
      userId: user.id,
      email: user.email,
      handle: user.xUsername,
      provider,
    },
    opts,
  );
}
