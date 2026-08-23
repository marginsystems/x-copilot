/**
 * Plan precedence: live Stripe sub, complimentary grant, then Free.
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

export function effectivePlanKey(
  row: UserBillingRow,
  email: string | null | undefined,
): PlanKey {
  if (liveSubTakesPrecedence(row)) return row.planKey;
  if (isAdminEmail(email)) return "horizon";
  if (row.grantPlanKey && isPaidPlanKey(row.grantPlanKey)) return row.grantPlanKey;
  return "free";
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
