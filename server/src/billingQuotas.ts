/**
 * Credit and daily-activity quota gates.
 */
import {
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { countOwnPostsSince, startOfUtcDayIso } from "./ownPostStore.js";
import { PLAN_DAILY_ACTIVITY_EVENTS, type PlanKey } from "./plans.js";
import {
  creditLimitForPlan,
  effectivePlanKey,
} from "./planResolution.js";
import { getSortieUsage } from "./scoutSorties.js";

export function startOfUtcMonthIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

export function countPostsReadThisUtcMonth(tenantId: string): number {
  const since = startOfUtcMonthIso();
  const row = getPlatformDb()
    .prepare(
      `SELECT COALESCE(SUM(posts_read), 0) AS n
       FROM x_api_usage_events
       WHERE tenant_id = ? AND at >= ? AND path LIKE '%/tweets%'`,
    )
    .get(tenantId, since) as { n: number };
  return Number(row.n) || 0;
}

export type CreditUsage = {
  planKey: PlanKey;
  used: number;
  limit: number;
  remaining: number;
  canUse: boolean;
};

export function getCreditUsage(
  tenantId: string,
  planKey: PlanKey,
): CreditUsage {
  const used = countPostsReadThisUtcMonth(tenantId);
  const limit = creditLimitForPlan(planKey);
  const remaining = Math.max(0, limit - used);
  return {
    planKey,
    used,
    limit,
    remaining,
    canUse: remaining > 0,
  };
}

export function dailyActivityUsage(
  userId: string,
  email: string | null | undefined,
): {
  used: number;
  limit: number;
  remaining: number;
  can_watch: boolean;
  planKey: PlanKey;
} {
  const tenantId = ensureUserTenant(userId);
  const row = ensureUserBillingRow(userId, tenantId);
  const planKey = effectivePlanKey(row, email);
  const limit = PLAN_DAILY_ACTIVITY_EVENTS[planKey];
  const used = countOwnPostsSince(userId, startOfUtcDayIso());
  const remaining = Math.max(0, limit - used);
  return {
    used,
    limit,
    remaining,
    can_watch: remaining > 0,
    planKey,
  };
}

/** 402 body when the monthly pool is empty. null = allow Scout. */
export function creditsExhaustedResponse(input: {
  userId?: string;
  tenantId: string;
  email?: string | null;
}): {
  error: "credits_exhausted";
  message: string;
  used: number;
  limit: number;
  planKey: PlanKey;
} | null {
  if (!input.userId) return null;
  const row = ensureUserBillingRow(input.userId, input.tenantId);
  const planKey = effectivePlanKey(row, input.email);
  const usage = getCreditUsage(input.tenantId, planKey);
  if (usage.canUse) return null;
  const pool =
    planKey === "free"
      ? `${usage.limit.toLocaleString()} free credits`
      : `${usage.limit.toLocaleString()} credits`;
  return {
    error: "credits_exhausted",
    message: `You've used this month's ${pool}. Upgrade on Usage & Billing, or wait until the next UTC month.`,
    used: usage.used,
    limit: usage.limit,
    planKey,
  };
}

/** 429 body when today's Take offs are used. null = allow. */
export function sortiesExhaustedResponse(input: {
  userId?: string;
  tenantId: string;
  email?: string | null;
}): {
  error: "scout_daily_limit";
  message: string;
  used: number;
  limit: number;
  planKey: PlanKey;
} | null {
  if (!input.userId) return null;
  const row = ensureUserBillingRow(input.userId, input.tenantId);
  const planKey = effectivePlanKey(row, input.email);
  const usage = getSortieUsage(input.tenantId, planKey);
  if (usage.canFly) return null;
  return {
    error: "scout_daily_limit",
    message: `Grounded — ${usage.limit} sortie${usage.limit === 1 ? "" : "s"} used today. Next takeoff after 00:00 UTC.`,
    used: usage.used,
    limit: usage.limit,
    planKey,
  };
}
