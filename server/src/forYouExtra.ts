/**
 * Credit-backed extra Approach originals. Not the daily digest.
 */
import { randomUUID } from "node:crypto";
import {
  FOR_YOU_EXTRA_USAGE_PATH,
  getCreditUsage,
} from "./billingQuotas.js";
import { getPlatformDb } from "./db.js";
import { startOfUtcDayIso } from "./ownPostStore.js";
import type { PlanKey } from "./plans.js";

export { FOR_YOU_EXTRA_USAGE_PATH };

export const FOR_YOU_EXTRA_CREDIT_COST = 15;
export const FOR_YOU_EXTRA_BATCH_SIZE = 3;
export const FOR_YOU_EXTRA_DAILY_BATCHES = 10;

export function countExtraBatchesToday(
  userId: string,
  now = new Date(),
): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM for_you_extras WHERE user_id = ? AND at >= ?`,
    )
    .get(userId, startOfUtcDayIso(now)) as { n: number };
  return Number(row?.n ?? 0);
}

export function recordExtraBatch(
  userId: string,
  tenantId: string,
  at = new Date().toISOString(),
): string {
  const id = randomUUID();
  getPlatformDb()
    .prepare(
      `INSERT INTO for_you_extras (id, user_id, tenant_id, at) VALUES (?, ?, ?, ?)`,
    )
    .run(id, userId, tenantId, at);
  return id;
}

export function reserveExtraSlot(
  userId: string,
  tenantId: string,
  now = new Date(),
): string | null {
  return getPlatformDb().transaction(() => {
    if (countExtraBatchesToday(userId, now) >= FOR_YOU_EXTRA_DAILY_BATCHES) {
      return null;
    }
    return recordExtraBatch(userId, tenantId, now.toISOString());
  })();
}

export function removeExtraRecord(id: string): void {
  getPlatformDb().prepare(`DELETE FROM for_you_extras WHERE id = ?`).run(id);
}

export type ForYouExtraUsage = {
  cost: number;
  batchSize: number;
  used: number;
  limit: number;
  remaining: number;
  creditsRemaining: number;
  canExtra: boolean;
};

export function getExtraUsage(opts: {
  userId: string;
  tenantId: string;
  planKey: PlanKey;
  now?: Date;
}): ForYouExtraUsage {
  const now = opts.now ?? new Date();
  const used = countExtraBatchesToday(opts.userId, now);
  const limit = FOR_YOU_EXTRA_DAILY_BATCHES;
  const remaining = Math.max(0, limit - used);
  const credits = getCreditUsage(opts.tenantId, opts.planKey);
  return {
    cost: FOR_YOU_EXTRA_CREDIT_COST,
    batchSize: FOR_YOU_EXTRA_BATCH_SIZE,
    used,
    limit,
    remaining,
    creditsRemaining: credits.remaining,
    canExtra:
      remaining > 0 && credits.remaining >= FOR_YOU_EXTRA_CREDIT_COST,
  };
}

export function extraCapMessage(used: number, limit: number): string {
  return `That's ${used} extra batches today — ${limit} per UTC day. Next extras after 00:00 UTC.`;
}
