/**
 * Tenant-scoped X API usage ledger (shared platform credentials).
 * Tenants see credits; estimated $ is operator-only (/admin).
 */
import { randomUUID } from "node:crypto";
import {
  countPostsReadThisUtcMonth,
  CREDIT_EVENT_PATH_SQL,
  FOR_YOU_EXTRA_USAGE_PATH,
  POSTS_READ_EXCLUDING_EXTRA_SQL,
  startOfUtcMonthIso,
} from "./billingQuotas.js";
import { getPlatformDb } from "../db.js";
import { getRequestTenantId } from "../http/requestContext.js";
import { startOfUtcDayIso } from "../desk/ownPostStore.js";

/** Official Pay Per Use list price for a post read (~$0.005). */
export const POST_READ_USD_MICROS = 5_000;

export type UsageEventInput = {
  tenantId?: string;
  method?: string;
  path: string;
  status: number;
  error?: string;
  postsRead?: number;
  meta?: Record<string, unknown>;
  at?: string;
};

export type UsageEventRow = {
  id: string;
  tenantId: string;
  at: string;
  method: string;
  path: string;
  status: number;
  error: string | null;
  postsRead: number;
  costUsdMicros: number;
  metaJson: string | null;
};

export type UsageRecentRow = {
  id: string;
  at: string;
  method: string;
  path: string;
  status: number;
  error: string | null;
  postsRead: number;
  estimatedUsd: number;
  activity: string;
  credits: number;
  remaining: number | null;
};

export type UsageSummary = {
  tenantId: string;
  tenantSlug: string;
  window: "all" | "24h" | "7d";
  calls: number;
  postsRead: number;
  estimatedUsd: number;
  estimatedUsdMicros: number;
  creditsDepletedRecent: boolean;
  postReadUsd: number;
  creditLimit: number | null;
  monthCreditsUsed: number;
  remaining: number | null;
  note: string;
  recent: UsageRecentRow[];
};

export type TenantUsageRecent = {
  id: string;
  at: string;
  activity: string;
  status: number;
  error: string | null;
  credits: number;
  remaining: number | null;
};

export type TenantUsageView = {
  tenantId: string;
  tenantSlug: string;
  window: "all" | "24h" | "7d";
  calls: number;
  creditsUsed: number;
  creditLimit: number;
  remaining: number;
  creditsDepletedRecent: boolean;
  note: string;
  recent: TenantUsageRecent[];
};

const TENANT_USAGE_NOTE =
  "Each Scout search, post lookup, watched post.create, and Approach extra batch spends credits from this month's pool. One credit is one X post, except extras which cost 15 for three originals. Unused credits do not roll over.";

const ADMIN_USAGE_NOTE =
  "Credits are X post reads plus Approach extra batches this UTC month (hard ceiling, no rollover). Est. $ is platform COGS at ~$0.005/post — console.x.com remains wallet truth for the shared key.";

/** Friendly label for a logged X path. Scout search is the common tenant call. */
export function describeUsageActivity(
  path: string,
  error?: string | null,
): string {
  const p = (path.split("?")[0] ?? path).toLowerCase();
  if (p.includes("/tweets/search")) {
    if (error === "credits_depleted") {
      return "Scout search (platform read limit)";
    }
    if (error === "credits_exhausted") {
      return "Scout search (credits used up)";
    }
    return "Scout search";
  }
  if (p.includes("/activity/post.create")) return "Post watch";
  if (p === "/internal/for-you-extra") return "Approach extras";
  if (/\/tweets\/[^/]+$/.test(p)) return "Post lookup";
  if (p.includes("/tweets")) return "Post read";
  return "X API call";
}

/** Tenant payload: credits only — no paths, no dollar amounts. */
export function toTenantUsageView(summary: UsageSummary): TenantUsageView {
  return {
    tenantId: summary.tenantId,
    tenantSlug: summary.tenantSlug,
    window: summary.window,
    calls: summary.calls,
    creditsUsed: summary.monthCreditsUsed,
    creditLimit: summary.creditLimit ?? 0,
    remaining: summary.remaining ?? 0,
    creditsDepletedRecent: summary.creditsDepletedRecent,
    note: TENANT_USAGE_NOTE,
    recent: summary.recent.map((row) => ({
      id: row.id,
      at: row.at,
      activity: row.activity,
      status: row.status,
      error: row.error,
      credits: row.credits,
      remaining: row.remaining,
    })),
  };
}

export function microsToUsd(micros: number): number {
  return Math.round((micros / 1_000_000) * 1_000_000) / 1_000_000;
}

function tweetId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Post ids X would bill from a v2 tweet payload (data + includes.tweets). */
export function countPostReadIds(path: string, json: unknown): string[] {
  const p = path.split("?")[0] ?? path;
  if (!p.includes("/tweets")) return [];
  if (!json || typeof json !== "object") return [];
  const root = json as { data?: unknown; includes?: { tweets?: unknown } };
  const ids = new Set<string>();
  const data = root.data;
  if (Array.isArray(data)) {
    for (const t of data) {
      const id = tweetId(t);
      if (id) ids.add(id);
    }
    if (Array.isArray(root.includes?.tweets)) {
      for (const t of root.includes.tweets) {
        const id = tweetId(t);
        if (id) ids.add(id);
      }
    }
    return [...ids];
  }
  if (data && typeof data === "object") {
    const id = tweetId(data);
    return id ? [id] : [];
  }
  return [];
}

/** Count tweet objects in a v2 payload (search list or single tweet). */
export function countPostsRead(path: string, json: unknown): number {
  return countPostReadIds(path, json).length;
}

/**
 * X only bills a post once per UTC day. Return how many of these ids are
 * new for this tenant today and remember them.
 */
export function chargeUniquePostReads(
  ids: readonly string[],
  opts?: { tenantId?: string; now?: Date },
): number {
  const tenantId = opts?.tenantId?.trim() || getRequestTenantId();
  const dayUtc = startOfUtcDayIso(opts?.now).slice(0, 10);
  if (!tenantId || !ids.length) return 0;
  const insert = getPlatformDb().prepare(
    `INSERT OR IGNORE INTO usage_post_reads (tenant_id, post_id, day_utc)
     VALUES (?, ?, ?)`,
  );
  let n = 0;
  for (const raw of ids) {
    const id = raw.trim();
    if (!id) continue;
    const result = insert.run(tenantId, id, dayUtc);
    if (result.changes > 0) n += 1;
  }
  return n;
}

export function estimatePostReadCostMicros(postsRead: number): number {
  if (!Number.isFinite(postsRead) || postsRead <= 0) return 0;
  return Math.floor(postsRead) * POST_READ_USD_MICROS;
}

export function recordUsageEvent(input: UsageEventInput): boolean {
  try {
    const database = getPlatformDb();
    const tenantId = input.tenantId?.trim() || getRequestTenantId();
    const postsRead = Math.max(0, Math.floor(input.postsRead ?? 0));
    // Extras count toward the credit pool but make no X reads, so they add
    // no post-read COGS to the admin estimate.
    const costUsdMicros =
      input.path === FOR_YOU_EXTRA_USAGE_PATH
        ? 0
        : estimatePostReadCostMicros(postsRead);
    const id = randomUUID();
    const at = input.at ?? new Date().toISOString();
    database
      .prepare(
        `INSERT INTO x_api_usage_events
          (id, tenant_id, at, method, path, status, error, posts_read, cost_usd_micros, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        tenantId,
        at,
        input.method ?? "GET",
        input.path,
        input.status,
        input.error ?? null,
        postsRead,
        costUsdMicros,
        input.meta ? JSON.stringify(input.meta) : null,
      );
    return true;
  } catch (err) {
    console.error(
      "[usage-meter] record failed:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

function windowStartIso(window: "all" | "24h" | "7d"): string | null {
  if (window === "all") return null;
  const ms = window === "24h" ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

export function getUsageSummary(opts?: {
  tenantId?: string;
  window?: "all" | "24h" | "7d";
  limit?: number;
  creditLimit?: number;
}): UsageSummary {
  const database = getPlatformDb();
  const tenantId = opts?.tenantId?.trim() || getRequestTenantId();
  const window = opts?.window ?? "7d";
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const since = windowStartIso(window);
  const creditLimit =
    typeof opts?.creditLimit === "number" &&
    Number.isFinite(opts.creditLimit) &&
    opts.creditLimit >= 0
      ? Math.floor(opts.creditLimit)
      : null;
  const monthStartIso = startOfUtcMonthIso();
  const monthCreditsUsed = countPostsReadThisUtcMonth(tenantId);

  const tenant = database
    .prepare(`SELECT slug FROM tenants WHERE id = ?`)
    .get(tenantId) as { slug: string } | undefined;

  const agg = (
    since
      ? database
          .prepare(
            `SELECT
               COUNT(*) AS calls,
               COALESCE(SUM(${POSTS_READ_EXCLUDING_EXTRA_SQL}), 0) AS posts_read,
               COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND at >= ? AND ${CREDIT_EVENT_PATH_SQL}`,
          )
          .get(tenantId, since)
      : database
          .prepare(
            `SELECT
               COUNT(*) AS calls,
               COALESCE(SUM(${POSTS_READ_EXCLUDING_EXTRA_SQL}), 0) AS posts_read,
               COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND ${CREDIT_EVENT_PATH_SQL}`,
          )
          .get(tenantId)
  ) as {
    calls: number;
    posts_read: number;
    cost_usd_micros: number;
  };

  const depletedRow = (
    since
      ? database
          .prepare(
            `SELECT COUNT(*) AS n FROM x_api_usage_events
             WHERE tenant_id = ? AND at >= ? AND error = 'credits_depleted'`,
          )
          .get(tenantId, since)
      : database
          .prepare(
            `SELECT COUNT(*) AS n FROM x_api_usage_events
             WHERE tenant_id = ? AND error = 'credits_depleted'`,
          )
          .get(tenantId)
  ) as { n: number };

  const recentRaw = (
    since
      ? database
          .prepare(
            `SELECT id, at, method, path, status, error, posts_read, cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND at >= ? AND ${CREDIT_EVENT_PATH_SQL}
             ORDER BY at DESC
             LIMIT ?`,
          )
          .all(tenantId, since, limit)
      : database
          .prepare(
            `SELECT id, at, method, path, status, error, posts_read, cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND ${CREDIT_EVENT_PATH_SQL}
             ORDER BY at DESC
             LIMIT ?`,
          )
          .all(tenantId, limit)
  ) as Array<{
    id: string;
    at: string;
    method: string;
    path: string;
    status: number;
    error: string | null;
    posts_read: number;
    cost_usd_micros: number;
  }>;

  const estimatedUsdMicros = Number(agg.cost_usd_micros) || 0;
  const remaining =
    creditLimit === null ? null : Math.max(0, creditLimit - monthCreditsUsed);
  let remainingCursor = remaining;

  return {
    tenantId,
    tenantSlug: tenant?.slug ?? "local",
    window,
    calls: Number(agg.calls) || 0,
    postsRead: Number(agg.posts_read) || 0,
    estimatedUsd: microsToUsd(estimatedUsdMicros),
    estimatedUsdMicros,
    creditsDepletedRecent: (Number(depletedRow.n) || 0) > 0,
    postReadUsd: microsToUsd(POST_READ_USD_MICROS),
    creditLimit,
    monthCreditsUsed,
    remaining,
    note: ADMIN_USAGE_NOTE,
    recent: recentRaw.map((r) => {
      const credits = Number(r.posts_read) || 0;
      const inMonth = r.at >= monthStartIso;
      const rowRemaining =
        inMonth && remainingCursor !== null ? remainingCursor : null;
      if (inMonth && remainingCursor !== null) {
        remainingCursor += credits;
      }
      return {
        id: r.id,
        at: r.at,
        method: r.method,
        path: r.path,
        status: r.status,
        error: r.error,
        postsRead: credits,
        estimatedUsd: microsToUsd(r.cost_usd_micros),
        activity: describeUsageActivity(r.path, r.error),
        credits,
        remaining: rowRemaining,
      };
    }),
  };
}
