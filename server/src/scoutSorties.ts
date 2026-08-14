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

export function recordSortie(tenantId?: string, at?: string): void {
  const id = randomUUID();
  getPlatformDb()
    .prepare(`INSERT INTO scout_sorties (id, tenant_id, at) VALUES (?, ?, ?)`)
    .run(
      id,
      tenantId?.trim() || getRequestTenantId(),
      at ?? new Date().toISOString(),
    );
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
