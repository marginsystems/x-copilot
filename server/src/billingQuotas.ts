/**
 * Credit and daily-activity quota gates.
 */
import {
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { countOwnPostsSince, startOfUtcDayIso } from "./ownPostStore.js";
import {
  PLAN_DAILY_ACTIVITY_EVENTS,
  PLAN_DAILY_SUGGESTS,
  nextPaidPlanKey,
  planDisplayName,
  type PlanKey,
} from "./plans.js";
import {
  creditLimitForPlan,
  resolvePlan,
  type PlanResolveReason,
} from "./planResolution.js";
import { getSortieUsage } from "./scoutSorties.js";

export function startOfUtcMonthIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

/** Approach extras debit credits without pretending to be an X tweet read. */
export const FOR_YOU_EXTRA_USAGE_PATH = "/internal/for-you-extra";

/** Monthly credit pool: X tweet reads plus Approach extra batches. */
export const CREDIT_EVENT_PATH_SQL =
  "(path LIKE '%/tweets%' OR path = '/internal/for-you-extra')";

/**
 * Display "X posts read" per event row: extras record their 15-credit cost in
 * posts_read for the credit pool (countPostsReadThisUtcMonth) but made no X
 * reads, so they contribute 0 to the posts-read ledger shown to operators.
 */
export const POSTS_READ_EXCLUDING_EXTRA_SQL =
  `CASE WHEN path = '${FOR_YOU_EXTRA_USAGE_PATH}' THEN 0 ELSE posts_read END`;

export function countPostsReadThisUtcMonth(tenantId: string): number {
  const since = startOfUtcMonthIso();
  const row = getPlatformDb()
    .prepare(
      `SELECT COALESCE(SUM(posts_read), 0) AS n
       FROM x_api_usage_events
       WHERE tenant_id = ? AND at >= ? AND ${CREDIT_EVENT_PATH_SQL}`,
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
  const planKey = resolvePlan(row, email).planKey;
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
  const resolved = resolvePlan(row, input.email);
  const planKey = resolved.planKey;
  const usage = getCreditUsage(input.tenantId, planKey);
  if (usage.canUse) return null;
  const pool =
    planKey === "free"
      ? `${usage.limit.toLocaleString()} free credits`
      : `${usage.limit.toLocaleString()} credits`;
  return {
    error: "credits_exhausted",
    message: `You've used this month's ${pool}. ${upgradeHint(planKey, resolved.reason)} Or wait until the next UTC month.`,
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
  const resolved = resolvePlan(row, input.email);
  const planKey = resolved.planKey;
  const usage = getSortieUsage(input.tenantId, planKey);
  if (usage.canFly) return null;
  return {
    error: "scout_daily_limit",
    message: `Grounded — ${usage.limit} takeoff${usage.limit === 1 ? "" : "s"} used today. Next takeoff after 00:00 UTC. ${upgradeHint(planKey, resolved.reason)}`,
    used: usage.used,
    limit: usage.limit,
    planKey,
  };
}

/** Next-plan line for Grounded / credits / suggest-cap copy. */
export function upgradeHint(
  planKey: PlanKey,
  reason: PlanResolveReason = "free",
): string {
  if (reason === "first_week") {
    return "Subscribe to Pulse to keep these limits after your first week. Open Usage & Billing.";
  }
  const next = nextPaidPlanKey(planKey);
  if (!next) return "Open Usage & Billing.";
  return `${planDisplayName(next)} raises this — open Usage & Billing.`;
}

export function suggestCapMessage(
  planKey: PlanKey,
  limit: number,
  reason: PlanResolveReason = "free",
): string {
  const base = `That's ${limit} suggested drafts today — the well refills at 00:00 UTC.`;
  if (reason === "first_week") return `${base} ${upgradeHint(planKey, reason)}`;
  const next = nextPaidPlanKey(planKey);
  if (!next) return `${base} ${upgradeHint(planKey, reason)}`;
  return `${base} ${planDisplayName(next)} is ${PLAN_DAILY_SUGGESTS[next]}/day — open Usage & Billing.`;
}
