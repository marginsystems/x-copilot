/**
 * Tenant-scoped X API usage ledger (shared platform credentials).
 * Estimates post-read cost; console.x.com remains source of truth for balance.
 */
import { randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";
import { getRequestTenantId } from "./requestContext.js";

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
  note: string;
  recent: Array<{
    id: string;
    at: string;
    method: string;
    path: string;
    status: number;
    error: string | null;
    postsRead: number;
    estimatedUsd: number;
  }>;
};

export function microsToUsd(micros: number): number {
  return Math.round((micros / 1_000_000) * 1_000_000) / 1_000_000;
}

/** Count tweet objects in a v2 payload (search list or single tweet). */
export function countPostsRead(path: string, json: unknown): number {
  const p = path.split("?")[0] ?? path;
  if (!p.includes("/tweets")) return 0;
  if (!json || typeof json !== "object") return 0;
  const root = json as { data?: unknown; includes?: { tweets?: unknown } };
  const data = root.data;
  if (Array.isArray(data)) {
    const ids = new Set<string>();
    for (const t of data) {
      if (
        t &&
        typeof t === "object" &&
        typeof (t as { id?: unknown }).id === "string"
      ) {
        ids.add((t as { id: string }).id);
      }
    }
    let count = data.length;
    if (Array.isArray(root.includes?.tweets)) {
      for (const t of root.includes.tweets) {
        if (
          t &&
          typeof t === "object" &&
          typeof (t as { id?: unknown }).id === "string" &&
          !ids.has((t as { id: string }).id)
        ) {
          count += 1;
        }
      }
    }
    return count;
  }
  if (data && typeof data === "object") return 1;
  return 0;
}

export function estimatePostReadCostMicros(postsRead: number): number {
  if (!Number.isFinite(postsRead) || postsRead <= 0) return 0;
  return Math.floor(postsRead) * POST_READ_USD_MICROS;
}

export function recordUsageEvent(input: UsageEventInput): void {
  try {
    const database = getPlatformDb();
    const tenantId = input.tenantId?.trim() || getRequestTenantId();
    const postsRead = Math.max(0, Math.floor(input.postsRead ?? 0));
    const costUsdMicros = estimatePostReadCostMicros(postsRead);
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
  } catch (err) {
    console.error(
      "[usage-meter] record failed:",
      err instanceof Error ? err.message : String(err),
    );
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
}): UsageSummary {
  const database = getPlatformDb();
  const tenantId = opts?.tenantId?.trim() || getRequestTenantId();
  const window = opts?.window ?? "7d";
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const since = windowStartIso(window);

  const tenant = database
    .prepare(`SELECT slug FROM tenants WHERE id = ?`)
    .get(tenantId) as { slug: string } | undefined;

  const agg = (
    since
      ? database
          .prepare(
            `SELECT
               COUNT(*) AS calls,
               COALESCE(SUM(posts_read), 0) AS posts_read,
               COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND at >= ? AND path LIKE '%/tweets%'`,
          )
          .get(tenantId, since)
      : database
          .prepare(
            `SELECT
               COUNT(*) AS calls,
               COALESCE(SUM(posts_read), 0) AS posts_read,
               COALESCE(SUM(cost_usd_micros), 0) AS cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND path LIKE '%/tweets%'`,
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
             WHERE tenant_id = ? AND at >= ? AND path LIKE '%/tweets%'
             ORDER BY at DESC
             LIMIT ?`,
          )
          .all(tenantId, since, limit)
      : database
          .prepare(
            `SELECT id, at, method, path, status, error, posts_read, cost_usd_micros
             FROM x_api_usage_events
             WHERE tenant_id = ? AND path LIKE '%/tweets%'
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
    note:
      "Credits on your desk are X post reads this UTC month (hard ceiling, no rollover). Est. $ is our COGS at ~$0.005/post — console.x.com remains wallet truth for the shared platform key.",
    recent: recentRaw.map((r) => ({
      id: r.id,
      at: r.at,
      method: r.method,
      path: r.path,
      status: r.status,
      error: r.error,
      postsRead: r.posts_read,
      estimatedUsd: microsToUsd(r.cost_usd_micros),
    })),
  };
}
