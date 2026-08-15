/**
 * Register the XAA webhook once and subscribe each desk user to post.create.
 */
import { getPlatformDb } from "./db.js";
import { X_API_BASE, getXApiCredsFromEnv } from "./xApi.js";
import { getUserById, getXOauthUsername } from "./authStore.js";
import { parseXHandle } from "./xHandle.js";

// How long a subscribe "claim" reserves a due row while the X-side POST is in
// flight. Expires harmlessly: a crashed process leaves a future paused_until
// that the next boot/hourly resume pass retries.
const SUBSCRIBE_CLAIM_MS = 120_000;

function activityNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_TEST_CONTEXT) return false;
  if (env.X_ACTIVITY_DISABLE === "1") return false;
  return true;
}

export function activityWebhookUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.X_ACTIVITY_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return "https://api.xcopilot.dev/api/x/activity";
}

async function xJson(opts: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const creds = getXApiCredsFromEnv();
  if (!creds.bearerToken) {
    return { ok: false, status: 0, json: { error: "missing_bearer" } };
  }
  const res = await fetch(`${X_API_BASE}${opts.path}`, {
    method: opts.method,
    headers: {
      Authorization: `Bearer ${creds.bearerToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json };
}

export function getStoredWebhookId(): string | null {
  const fromEnv = process.env.X_ACTIVITY_WEBHOOK_ID?.trim();
  if (fromEnv) return fromEnv;
  const row = getPlatformDb()
    .prepare(
      `SELECT webhook_id FROM activity_subscriptions
       WHERE webhook_id IS NOT NULL AND TRIM(webhook_id) != ''
       LIMIT 1`,
    )
    .get() as { webhook_id: string } | undefined;
  return row?.webhook_id?.trim() || null;
}

export async function ensureActivityWebhook(): Promise<string | null> {
  if (!activityNetworkEnabled()) return getStoredWebhookId();
  const existing = getStoredWebhookId();
  if (existing) return existing;
  const url = activityWebhookUrl();
  if (url.includes("127.0.0.1") || url.includes("localhost")) {
    console.warn("[xaa] skip webhook register on loopback URL");
    return null;
  }
  const listed = await xJson({ method: "GET", path: "/activity/webhooks" });
  const data = (listed.json as { data?: Array<{ id?: string; url?: string }> })
    ?.data;
  if (Array.isArray(data)) {
    const hit = data.find((w) => w.url === url && w.id);
    if (hit?.id) return String(hit.id);
  }
  const created = await xJson({
    method: "POST",
    path: "/activity/webhooks",
    body: { url },
  });
  const id = (created.json as { data?: { id?: string } })?.data?.id;
  if (!created.ok || !id) {
    console.warn("[xaa] webhook register failed", created.status, created.json);
    return null;
  }
  return String(id);
}

export async function lookupXUserId(username: string): Promise<string | null> {
  if (!activityNetworkEnabled()) return null;
  const handle = parseXHandle(username);
  if (!handle) return null;
  const creds = getXApiCredsFromEnv();
  if (!creds.bearerToken) return null;
  const res = await fetch(
    `${X_API_BASE}/users/by/username/${encodeURIComponent(handle)}`,
    {
      headers: {
        Authorization: `Bearer ${creds.bearerToken}`,
        Accept: "application/json",
      },
    },
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data?: { id?: string } };
  return json.data?.id?.trim() || null;
}

export function resolveStoredXUserId(userId: string): string | null {
  const sub = getPlatformDb()
    .prepare(`SELECT x_user_id FROM activity_subscriptions WHERE user_id = ?`)
    .get(userId) as { x_user_id: string } | undefined;
  if (sub?.x_user_id) return sub.x_user_id;
  const oauth = getPlatformDb()
    .prepare(
      `SELECT provider_user_id FROM oauth_accounts
       WHERE user_id = ? AND provider = 'x' LIMIT 1`,
    )
    .get(userId) as { provider_user_id: string } | undefined;
  return oauth?.provider_user_id?.trim() || null;
}

export function findUserIdByXUserId(xUserId: string): string | null {
  const sub = getPlatformDb()
    .prepare(`SELECT user_id FROM activity_subscriptions WHERE x_user_id = ?`)
    .get(xUserId) as { user_id: string } | undefined;
  return sub?.user_id ?? null;
}

export async function subscribeUserToPostCreate(userId: string): Promise<{
  ok: boolean;
  paused?: boolean;
  subscriptionId?: string;
  error?: string;
}> {
  if (!activityNetworkEnabled()) {
    return { ok: false, error: "xaa_disabled" };
  }
  const webhookId = await ensureActivityWebhook();
  if (!webhookId) return { ok: false, error: "webhook_unregistered" };
  let xUserId = resolveStoredXUserId(userId);
  if (!xUserId) {
    const user = getUserById(userId);
    const handle = user?.xUsername || getXOauthUsername(userId);
    if (handle) xUserId = await lookupXUserId(handle);
  }
  if (!xUserId) return { ok: false, error: "x_user_id_unresolved" };

  const existing = getPlatformDb()
    .prepare(`SELECT subscription_id, paused_until FROM activity_subscriptions WHERE user_id = ?`)
    .get(userId) as
    | { subscription_id: string | null; paused_until: string | null }
    | undefined;
  const now = new Date().toISOString();
  if (existing?.paused_until && existing.paused_until > now) {
    return { ok: false, paused: true, error: "paused_until_reset" };
  }
  if (existing?.subscription_id) {
    if (existing.paused_until && existing.paused_until <= now) {
      getPlatformDb()
        .prepare(
          `UPDATE activity_subscriptions
           SET paused_until = NULL, updated_at = ?
           WHERE user_id = ? AND subscription_id = ?
             AND paused_until IS NOT NULL AND paused_until <= ?`,
        )
        .run(now, userId, existing.subscription_id, now);
    }
    return { ok: true, subscriptionId: existing.subscription_id };
  }

  // Reserve the row before the network call so a concurrent process (sidecar
  // boot + stats-worker tick) cannot both POST and create a duplicate X-side
  // subscription. Exactly one caller wins the claim; the loser backs off.
  const claimUntil = new Date(Date.now() + SUBSCRIBE_CLAIM_MS).toISOString();
  const claim = getPlatformDb()
    .prepare(
      `INSERT INTO activity_subscriptions
         (user_id, x_user_id, subscription_id, webhook_id, paused_until, created_at, updated_at)
       VALUES (?, ?, NULL, NULL, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         paused_until = excluded.paused_until,
         updated_at = excluded.updated_at
       WHERE subscription_id IS NULL
         AND (paused_until IS NULL OR paused_until <= ?)`,
    )
    .run(userId, xUserId, claimUntil, now, now, now);
  if (claim.changes === 0) {
    const current = getPlatformDb()
      .prepare(`SELECT subscription_id FROM activity_subscriptions WHERE user_id = ?`)
      .get(userId) as { subscription_id: string | null } | undefined;
    if (current?.subscription_id) {
      return { ok: true, subscriptionId: current.subscription_id };
    }
    return { ok: false, error: "subscribe_in_flight" };
  }

  const created = await xJson({
    method: "POST",
    path: "/activity/subscriptions",
    body: {
      event_type: "post.create",
      filter: { user_id: xUserId },
      tag: `xc:${userId}`,
      webhook_id: webhookId,
    },
  });
  const subscriptionId = (
    created.json as { data?: { subscription_id?: string } }
  )?.data?.subscription_id;
  if (!created.ok || !subscriptionId) {
    getPlatformDb()
      .prepare(
        `UPDATE activity_subscriptions
         SET paused_until = ?, updated_at = ?
         WHERE user_id = ? AND subscription_id IS NULL`,
      )
      .run(existing?.paused_until ?? now, new Date().toISOString(), userId);
    return { ok: false, error: "subscribe_failed" };
  }
  const at = new Date().toISOString();
  getPlatformDb()
    .prepare(
      `INSERT INTO activity_subscriptions
         (user_id, x_user_id, subscription_id, webhook_id, paused_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         x_user_id = excluded.x_user_id,
         subscription_id = excluded.subscription_id,
         webhook_id = excluded.webhook_id,
         paused_until = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(userId, xUserId, subscriptionId, webhookId, at, at);
  return { ok: true, subscriptionId };
}

export async function pauseUserSubscription(userId: string, untilIso: string): Promise<void> {
  const row = getPlatformDb()
    .prepare(`SELECT subscription_id FROM activity_subscriptions WHERE user_id = ?`)
    .get(userId) as { subscription_id: string | null } | undefined;
  let deleteOk = true;
  if (row?.subscription_id) {
    const res = await xJson({
      method: "DELETE",
      path: `/activity/subscriptions/${encodeURIComponent(row.subscription_id)}`,
    });
    // A 404 means the X-side subscription is already gone, so NULL the stored
    // id and let the claim path re-create it on resume. Only keep the id for
    // transient failures (429/5xx) where the DELETE is worth retrying.
    deleteOk = res.ok || res.status === 404;
  }
  getPlatformDb()
    .prepare(
      `UPDATE activity_subscriptions
       SET subscription_id = ?, paused_until = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(deleteOk ? null : row?.subscription_id, untilIso, new Date().toISOString(), userId);
}

export async function resumeDueSubscriptions(): Promise<number> {
  const now = new Date().toISOString();
  const rows = getPlatformDb()
    .prepare(
      `SELECT user_id FROM activity_subscriptions
       WHERE paused_until IS NOT NULL AND paused_until <= ?`,
    )
    .all(now) as Array<{ user_id: string }>;
  let n = 0;
  for (const row of rows) {
    const res = await subscribeUserToPostCreate(row.user_id);
    if (res.ok) n += 1;
  }
  return n;
}
