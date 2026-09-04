/**
 * Register the XAA webhook once and subscribe each desk user to own-post
 * create and delete events.
 *
 * Official V2: list/create webhooks at /2/webhooks. Activity subscriptions
 * stay at /2/activity/subscriptions. /2/activity/webhooks does not exist
 * (prod logged 404 on every boot).
 */
import { getPlatformDb } from "./db.js";
import { X_API_BASE, getXApiCredsFromEnv } from "./xApi.js";
import { getXOauthUsername } from "./xIdentityStore.js";
import { parseXHandle } from "./xHandle.js";

// How long a subscribe "claim" reserves a due row while the X-side POST is in
// flight. Expires harmlessly: a crashed process leaves a future paused_until
// that the next boot/hourly resume pass retries.
const SUBSCRIBE_CLAIM_MS = 120_000;

/** GET/POST `${X_API_BASE}` + this. Not `/activity/webhooks`. */
export const X_WEBHOOKS_PATH = "/webhooks";
/** POST/DELETE `${X_API_BASE}` + this. */
export const X_ACTIVITY_SUBSCRIPTIONS_PATH = "/activity/subscriptions";

type XJsonFn = (opts: {
  method: string;
  path: string;
  body?: unknown;
}) => Promise<{ ok: boolean; status: number; json: unknown }>;

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

async function deleteActivitySubscription(
  subscriptionId: string | null | undefined,
): Promise<boolean> {
  if (!subscriptionId) return true;
  const res = await xJson({
    method: "DELETE",
    path: `${X_ACTIVITY_SUBSCRIPTIONS_PATH}/${encodeURIComponent(subscriptionId)}`,
  });
  return res.ok || res.status === 404;
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

export function findListedWebhookId(
  json: unknown,
  url: string,
): string | null {
  const data = (json as { data?: Array<{ id?: string; url?: string }> })?.data;
  if (!Array.isArray(data)) return null;
  const hit = data.find((w) => w.url === url && w.id);
  return hit?.id ? String(hit.id) : null;
}

export function webhookIdFromCreate(json: unknown): string | null {
  const id = (json as { data?: { id?: string } })?.data?.id;
  return id ? String(id) : null;
}

type ActivitySubscriptionRow = {
  subscription_id?: string;
  event_type?: string;
  filter?: { user_id?: string };
  webhook_id?: string;
};

/** Official create returns `data` as an object or a one-item array. */
export function subscriptionIdFromCreate(json: unknown): string | null {
  const data = (json as { data?: ActivitySubscriptionRow | ActivitySubscriptionRow[] })
    ?.data;
  const row = Array.isArray(data) ? data[0] : data;
  return row?.subscription_id ? String(row.subscription_id) : null;
}

export function findListedSubscriptionId(
  json: unknown,
  xUserId: string,
  webhookId: string,
  eventType = "post.create",
): string | null {
  const data = (json as { data?: ActivitySubscriptionRow | ActivitySubscriptionRow[] })
    ?.data;
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const hit = rows.find(
    (row) =>
      row.event_type === eventType &&
      row.filter?.user_id === xUserId &&
      row.webhook_id === webhookId &&
      row.subscription_id,
  );
  return hit?.subscription_id ? String(hit.subscription_id) : null;
}

export function activitySubscriptionBody(
  eventType: "post.create" | "post.delete",
  xUserId: string,
  webhookId: string,
  userId: string,
): Record<string, unknown> {
  return {
    event_type: eventType,
    filter: { user_id: xUserId },
    tag: `xc:${userId}`,
    webhook_id: webhookId,
  };
}

export async function ensureActivityEventSubscription(opts: {
  eventType: "post.create" | "post.delete";
  xUserId: string;
  webhookId: string;
  userId: string;
  request: XJsonFn;
}): Promise<string | null> {
  const listed = await opts.request({
    method: "GET",
    path: X_ACTIVITY_SUBSCRIPTIONS_PATH,
  });
  if (!listed.ok) return null;
  const existing = findListedSubscriptionId(
    listed.json,
    opts.xUserId,
    opts.webhookId,
    opts.eventType,
  );
  if (existing) return existing;
  const created = await opts.request({
    method: "POST",
    path: X_ACTIVITY_SUBSCRIPTIONS_PATH,
    body: activitySubscriptionBody(
      opts.eventType,
      opts.xUserId,
      opts.webhookId,
      opts.userId,
    ),
  });
  const createdId = subscriptionIdFromCreate(created.json);
  if (created.ok && createdId) return createdId;
  const relisted = await opts.request({
    method: "GET",
    path: X_ACTIVITY_SUBSCRIPTIONS_PATH,
  });
  return relisted.ok
    ? findListedSubscriptionId(
        relisted.json,
        opts.xUserId,
        opts.webhookId,
        opts.eventType,
      )
    : null;
}

/** List then create against /2/webhooks. Used by boot; injectable for tests. */
export async function registerActivityWebhook(opts: {
  url: string;
  request: XJsonFn;
}): Promise<string | null> {
  const listed = await opts.request({ method: "GET", path: X_WEBHOOKS_PATH });
  const listedData = (listed.json as {
    data?: Array<{ id?: string; url?: string; valid?: boolean }>;
  })?.data;
  const existingWebhook = Array.isArray(listedData)
    ? listedData.find((w) => w.url === opts.url && w.id)
    : undefined;
  if (existingWebhook?.id && existingWebhook.valid !== false) {
    return String(existingWebhook.id);
  }
  if (existingWebhook?.id) {
    const registered = await opts.request({
      method: "PUT",
      path: `${X_WEBHOOKS_PATH}/${encodeURIComponent(String(existingWebhook.id))}`,
    });
    if (!registered.ok) {
      console.warn(
        "[xaa] webhook registration failed",
        registered.status,
        registered.json,
      );
      return null;
    }
    return String(existingWebhook.id);
  }
  const created = await opts.request({
    method: "POST",
    path: X_WEBHOOKS_PATH,
    body: { url: opts.url },
  });
  const id = webhookIdFromCreate(created.json);
  if (!created.ok || !id) {
    console.warn("[xaa] webhook register failed", created.status, created.json);
    return null;
  }
  const registered = await opts.request({
    method: "PUT",
    path: `${X_WEBHOOKS_PATH}/${encodeURIComponent(id)}`,
  });
  if (!registered.ok) {
    console.warn(
      "[xaa] webhook registration failed",
      registered.status,
      registered.json,
    );
    return null;
  }
  return id;
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
  return registerActivityWebhook({ url, request: xJson });
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
  if (sub?.user_id) return sub.user_id;
  const oauth = getPlatformDb()
    .prepare(
      `SELECT user_id FROM oauth_accounts
       WHERE provider = 'x' AND provider_user_id = ? LIMIT 1`,
    )
    .get(xUserId) as { user_id: string } | undefined;
  return oauth?.user_id ?? null;
}

export async function subscribeUserToPostCreate(
  userId: string,
  opts?: { xUserId?: string },
): Promise<{
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
  let xUserId = opts?.xUserId ?? resolveStoredXUserId(userId);
  if (!xUserId) {
    const handle = getXOauthUsername(userId);
    if (handle) xUserId = await lookupXUserId(handle);
  }
  if (!xUserId) return { ok: false, error: "x_user_id_unresolved" };

  const existing = getPlatformDb()
    .prepare(
      `SELECT subscription_id, delete_subscription_id, x_user_id, paused_until
       FROM activity_subscriptions WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        subscription_id: string | null;
        delete_subscription_id: string | null;
        x_user_id: string | null;
        paused_until: string | null;
      }
    | undefined;
  const now = new Date().toISOString();
  if (
    existing?.x_user_id === xUserId &&
    existing.paused_until &&
    existing.paused_until > now
  ) {
    return { ok: false, paused: true, error: "paused_until_reset" };
  }
  if (
    existing?.x_user_id === xUserId &&
    existing.subscription_id &&
    existing.delete_subscription_id
  ) {
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
          x_user_id = excluded.x_user_id,
          paused_until = excluded.paused_until,
          updated_at = excluded.updated_at
        WHERE (subscription_id IS NULL OR delete_subscription_id IS NULL
          OR x_user_id IS NOT excluded.x_user_id)
          AND (paused_until IS NULL OR paused_until <= ?)`,
    )
    .run(userId, xUserId, claimUntil, now, now, now);
  if (claim.changes === 0) {
    const current = getPlatformDb()
      .prepare(
        `SELECT subscription_id, delete_subscription_id, x_user_id
          FROM activity_subscriptions WHERE user_id = ?`,
      )
      .get(userId) as
      | {
          subscription_id: string | null;
          delete_subscription_id: string | null;
          x_user_id: string | null;
        }
      | undefined;
    if (
      current?.x_user_id === xUserId &&
      current.subscription_id &&
      current.delete_subscription_id
    ) {
      return { ok: true, subscriptionId: current.subscription_id };
    }
    return { ok: false, error: "subscribe_in_flight" };
  }

  const sameXAccount = existing?.x_user_id === xUserId;
  const subscriptionId =
    (sameXAccount ? existing?.subscription_id : null) ??
    (await ensureActivityEventSubscription({
      eventType: "post.create",
      xUserId,
      webhookId,
      userId,
      request: xJson,
    }));
  if (!subscriptionId) {
    console.warn("[xaa] post.create subscribe failed");
    getPlatformDb()
      .prepare(
        `UPDATE activity_subscriptions
         SET paused_until = ?, updated_at = ?
         WHERE user_id = ? AND subscription_id IS NULL`,
      )
      .run(existing?.paused_until ?? now, new Date().toISOString(), userId);
    return { ok: false, error: "subscribe_failed" };
  }

  const deleteSubscriptionId =
    (sameXAccount ? existing?.delete_subscription_id : null) ??
    (await ensureActivityEventSubscription({
      eventType: "post.delete",
      xUserId,
      webhookId,
      userId,
      request: xJson,
    }));
  if (!deleteSubscriptionId) {
    const at = new Date().toISOString();
    getPlatformDb()
      .prepare(
        `UPDATE activity_subscriptions
         SET x_user_id = ?, subscription_id = ?, webhook_id = ?,
             paused_until = ?, updated_at = ?
         WHERE user_id = ?`,
      )
      .run(
        xUserId,
        subscriptionId,
        webhookId,
        existing?.paused_until ?? at,
        at,
        userId,
      );
    console.warn("[xaa] post.delete subscribe failed");
    return { ok: false, error: "delete_subscribe_failed" };
  }
  const at = new Date().toISOString();
  getPlatformDb()
    .prepare(
      `INSERT INTO activity_subscriptions
         (user_id, x_user_id, subscription_id, delete_subscription_id,
          webhook_id, paused_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         x_user_id = excluded.x_user_id,
         subscription_id = excluded.subscription_id,
         delete_subscription_id = excluded.delete_subscription_id,
         webhook_id = excluded.webhook_id,
         paused_until = NULL,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      xUserId,
      subscriptionId,
      deleteSubscriptionId,
      webhookId,
      at,
      at,
    );
  return { ok: true, subscriptionId };
}

/**
 * Remove the user's live X-side own-post subscriptions so an account/handle
 * change can re-subscribe against the new account. Keeps stored ids when the
 * X-side DELETE fails so a later attempt can retry it. On success the stored
 * `subscription_id` AND the stored `x_user_id` are cleared (the row is kept,
 * like `pauseUserSubscription`) so a concurrent claim reservation and the
 * `paused_until`-based resume scan keep functioning, and a later subscribe
 * without an explicit target never re-resolves the old account. Clearing
 * `x_user_id` matters because the claim path only overwrites it on a fresh
 * INSERT — if the re-subscribe POST fails, a stale `x_user_id` from the old
 * account would otherwise survive and be picked up by `resolveStoredXUserId`.
 * Returns `{ ok: true }` when the stored id was cleared (nothing blocks a fresh
 * re-subscribe) and `{ ok: false }` when the DELETE failed and the old id was
 * retained.
 */
export async function removeUserPostCreateSubscription(
  userId: string,
): Promise<{ ok: boolean }> {
  const row = getPlatformDb()
    .prepare(
      `SELECT subscription_id, delete_subscription_id, x_user_id
       FROM activity_subscriptions WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        subscription_id: string | null;
        delete_subscription_id: string | null;
        x_user_id: string | null;
      }
    | undefined;
  const createDeleteOk = await deleteActivitySubscription(row?.subscription_id);
  const deleteDeleteOk = await deleteActivitySubscription(
    row?.delete_subscription_id,
  );
  const deleteOk = createDeleteOk && deleteDeleteOk;
  getPlatformDb()
    .prepare(
      `UPDATE activity_subscriptions
       SET subscription_id = ?, delete_subscription_id = ?,
           x_user_id = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      createDeleteOk ? null : row?.subscription_id ?? null,
      deleteDeleteOk ? null : row?.delete_subscription_id ?? null,
      deleteOk ? null : row?.x_user_id ?? null,
      new Date().toISOString(),
      userId,
    );
  return { ok: deleteOk };
}

export async function pauseUserSubscription(userId: string, untilIso: string): Promise<void> {
  const row = getPlatformDb()
    .prepare(
      `SELECT subscription_id, delete_subscription_id
       FROM activity_subscriptions WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        subscription_id: string | null;
        delete_subscription_id: string | null;
      }
    | undefined;
  const createDeleteOk = await deleteActivitySubscription(row?.subscription_id);
  const deleteDeleteOk = await deleteActivitySubscription(
    row?.delete_subscription_id,
  );
  getPlatformDb()
    .prepare(
      `UPDATE activity_subscriptions
       SET subscription_id = ?, delete_subscription_id = ?,
           paused_until = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      createDeleteOk ? null : row?.subscription_id,
      deleteDeleteOk ? null : row?.delete_subscription_id,
      untilIso,
      new Date().toISOString(),
      userId,
    );
}

export async function resumeDueSubscriptions(): Promise<number> {
  const now = new Date().toISOString();
  const rows = getPlatformDb()
    .prepare(
      `SELECT user_id FROM activity_subscriptions
       WHERE (delete_subscription_id IS NULL AND x_user_id IS NOT NULL)
          OR (paused_until IS NOT NULL AND paused_until <= ?)`,
    )
    .all(now) as Array<{ user_id: string }>;
  let n = 0;
  for (const row of rows) {
    const res = await subscribeUserToPostCreate(row.user_id);
    if (res.ok) n += 1;
  }
  return n;
}
