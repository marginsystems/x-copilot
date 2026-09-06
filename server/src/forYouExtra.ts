/** Historical extra Approach usage returned during boot hydration. */
import { getCreditUsage } from "./billingQuotas.js";
import { getPlatformDb } from "./db.js";
import { startOfUtcDayIso } from "./ownPostStore.js";
import type { PlanKey } from "./plans.js";

export const FOR_YOU_EXTRA_CREDIT_COST = 15;
export const FOR_YOU_EXTRA_BATCH_SIZE = 3;
export const FOR_YOU_EXTRA_DAILY_BATCHES = 10;

function countExtraBatchesToday(
  userId: string,
  now = new Date(),
): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM for_you_extras
       WHERE user_id = ? AND at >= ? AND (expires_at IS NULL OR expires_at > ?)`,
    )
    .get(userId, startOfUtcDayIso(now), now.toISOString()) as { n: number };
  return Number(row?.n ?? 0);
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
