/**
 * Fire-and-forget client for the analytics sidecar.
 * Never throws. Never blocks the request. No-op unless ANALYTICS_URL is set.
 */
import type { AnalyticsEventName } from "./analyticsEvents.js";
import type { AuthUser } from "./authStore.js";

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

export function analyticsClientEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.ANALYTICS_DISABLE === "1") return false;
  return Boolean(env.ANALYTICS_URL?.trim());
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
    const base = process.env.ANALYTICS_URL?.trim();
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
