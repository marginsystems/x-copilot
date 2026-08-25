/**
 * Plan precedence: live Stripe sub, complimentary grant, first-week
 * Pulse, then Free. First week is not a Stripe trial.
 */
import { isAdminEmail } from "./adminEmails.js";
import type { UserBillingRow } from "./billingStore.js";
import {
  PLAN_CREDIT_LIMITS,
  isPaidPlanKey,
  planDisplayName,
  type PaidPlanKey,
  type PlanKey,
} from "./plans.js";

const LIVE_SUB_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);
const NON_LIVE_SUB_STATUSES = new Set(["canceled", "incomplete_expired"]);

export const FIRST_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FIRST_WEEK_PLAN: PaidPlanKey = "pulse";

export type PlanResolveReason =
  | "stripe"
  | "admin"
  | "grant"
  | "first_week"
  | "free";

export type PlanResolution = {
  planKey: PlanKey;
  reason: PlanResolveReason;
  firstWeekEndsAt: string | null;
};

export function hasLiveStripeSubscription(row: UserBillingRow): boolean {
  const sub = row.stripeSubscriptionId?.trim();
  if (!sub) return false;
  const status = row.subscriptionStatus?.trim() || null;
  if (status && NON_LIVE_SUB_STATUSES.has(status)) return false;
  return true;
}

export function hasPaidBillingHistory(row: UserBillingRow): boolean {
  return Boolean(row.stripeCustomerId?.trim() || row.stripeSubscriptionId?.trim());
}

/** True when the live Stripe sub actually resolves to the effective plan. */
export function liveSubTakesPrecedence(row: UserBillingRow): boolean {
  const status = row.subscriptionStatus?.trim() || null;
  return (
    hasLiveStripeSubscription(row) &&
    isPaidPlanKey(row.planKey) &&
    (!status || LIVE_SUB_STATUSES.has(status))
  );
}

export function firstWeekEndsAt(
  createdAt: string | null | undefined,
): string | null {
  if (!createdAt?.trim()) return null;
  const start = Date.parse(createdAt);
  if (!Number.isFinite(start)) return null;
  return new Date(start + FIRST_WEEK_MS).toISOString();
}

export function firstWeekPulseActive(
  createdAt: string | null | undefined,
  now = new Date(),
): boolean {
  const ends = firstWeekEndsAt(createdAt);
  if (!ends) return false;
  return now.getTime() < Date.parse(ends);
}

export function firstWeekPulseNotice(endsAt: string): string {
  const when = new Date(endsAt).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `Your first week is a Pulse week — 5 takeoffs and 6,000 credits until ${when} UTC. Then Free. No credit card.`;
}

export function resolvePlan(
  row: UserBillingRow,
  email: string | null | undefined,
  now = new Date(),
): PlanResolution {
  if (liveSubTakesPrecedence(row)) {
    return { planKey: row.planKey, reason: "stripe", firstWeekEndsAt: null };
  }
  if (isAdminEmail(email)) {
    return { planKey: "horizon", reason: "admin", firstWeekEndsAt: null };
  }
  if (row.grantPlanKey && isPaidPlanKey(row.grantPlanKey)) {
    return { planKey: row.grantPlanKey, reason: "grant", firstWeekEndsAt: null };
  }
  if (firstWeekPulseActive(row.userCreatedAt, now)) {
    return {
      planKey: FIRST_WEEK_PLAN,
      reason: "first_week",
      firstWeekEndsAt: firstWeekEndsAt(row.userCreatedAt),
    };
  }
  return { planKey: "free", reason: "free", firstWeekEndsAt: null };
}

export function effectivePlanKey(
  row: UserBillingRow,
  email: string | null | undefined,
  now = new Date(),
): PlanKey {
  return resolvePlan(row, email, now).planKey;
}

export function manualGrantNotice(planKey: PaidPlanKey): string {
  return `This account was manually upgraded to ${planDisplayName(planKey)} without a Stripe subscription.`;
}

export function activeManualGrant(
  row: UserBillingRow,
  email: string | null | undefined,
): {
  plan_key: PaidPlanKey;
  created_at: string | null;
  created_by: string | null;
  notice: string;
} | null {
  if (!row.grantPlanKey) return null;
  if (liveSubTakesPrecedence(row)) return null;
  if (isAdminEmail(email)) return null;
  return {
    plan_key: row.grantPlanKey,
    created_at: row.grantCreatedAt,
    created_by: row.grantCreatedBy,
    notice: manualGrantNotice(row.grantPlanKey),
  };
}

export function creditLimitForPlan(plan: PlanKey): number {
  return PLAN_CREDIT_LIMITS[plan];
}
