/**
 * Daily Take off (sortie) cap — UTC day, per tenant.
 */
import { randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";
import { PLAN_DAILY_SORTIES, type PlanKey } from "./plans.js";
import { getRequestTenantId } from "./requestContext.js";

export function startOfUtcDayIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export function dailySortieLimit(plan: PlanKey): number {
  return PLAN_DAILY_SORTIES[plan];
}

export function countSortiesToday(
  tenantId: string,
  now = new Date(),
): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM scout_sorties
       WHERE tenant_id = ? AND at >= ?`,
    )
    .get(tenantId, startOfUtcDayIso(now)) as { n: number };
  return Number(row.n) || 0;
}

export function recordSortie(tenantId?: string, at?: string): string {
  const id = randomUUID();
  const db = getPlatformDb();
  const insert = db.prepare(
    `INSERT INTO scout_sorties (id, tenant_id, at) VALUES (?, ?, ?)`,
  );
  const prune = db.prepare(`DELETE FROM scout_sorties WHERE at < ?`);
  db.transaction(() => {
    prune.run(startOfUtcDayIso());
    insert.run(
      id,
      tenantId?.trim() || getRequestTenantId(),
      at ?? new Date().toISOString(),
    );
  })();
  return id;
}

/** Drop a recorded takeoff that did not deliver a cool thread. */
export function refundSortie(id: string): boolean {
  const trimmed = id.trim();
  if (!trimmed) return false;
  const result = getPlatformDb()
    .prepare("DELETE FROM scout_sorties WHERE id = ?")
    .run(trimmed);
  return result.changes > 0;
}

/**
 * Refund when the run delivered no cool threads — error, abort, or empty.
 * Keep the sortie if at least one cool landed, even on a later abort.
 */
export function sortieWasWasted({
  coolCount,
}: {
  ok: boolean;
  coolCount: number;
}): boolean {
  return coolCount < 1;
}

export type SortieUsage = {
  used: number;
  limit: number;
  remaining: number;
  canFly: boolean;
};

export function getSortieUsage(
  tenantId: string,
  planKey: PlanKey,
  now = new Date(),
): SortieUsage {
  const used = countSortiesToday(tenantId, now);
  const limit = dailySortieLimit(planKey);
  const remaining = Math.max(0, limit - used);
  return { used, limit, remaining, canFly: remaining > 0 };
}
