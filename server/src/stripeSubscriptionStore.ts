/**
 * Stripe subscription writes against user_billing.
 */
import {
  ensureUserBillingRow,
  getUserBilling,
  getUserBillingBySubscriptionId,
} from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import type { PaidPlanKey } from "./plans.js";

function nowIso(): string {
  return new Date().toISOString();
}

export function persistStripeCustomerId(
  userId: string,
  customerId: string,
): void {
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET stripe_customer_id = ?, updated_at = ? WHERE user_id = ?`,
    )
    .run(customerId, nowIso(), userId);
}

export function shouldApplyStripeEvent(
  storedCreated: number | null | undefined,
  eventCreated: number,
): boolean {
  if (storedCreated == null || storedCreated === 0) return true;
  return eventCreated >= storedCreated;
}

function nextWatermark(
  storedCreated: number | null | undefined,
  eventCreated: number | undefined,
): number {
  const incoming = eventCreated ?? 0;
  const stored = storedCreated ?? 0;
  return Math.max(stored, incoming);
}

export function activateSubscription(input: {
  userId: string;
  planKey: PaidPlanKey;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  stripeEventCreated?: number;
}): void {
  const row = ensureUserBillingRow(input.userId);
  if (!shouldApplyStripeEvent(row.stripeLastEventCreated, input.stripeEventCreated ?? 0)) {
    return;
  }
  const watermark = nextWatermark(
    row.stripeLastEventCreated,
    input.stripeEventCreated,
  );
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET
         plan_key = ?,
         stripe_customer_id = ?,
         stripe_subscription_id = ?,
         subscription_status = ?,
         current_period_end = ?,
         cancel_at_period_end = ?,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      input.planKey,
      input.stripeCustomerId,
      input.stripeSubscriptionId,
      input.subscriptionStatus,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      watermark,
      nowIso(),
      input.userId,
    );
}

export function updateSubscriptionFromStripe(input: {
  stripeSubscriptionId: string;
  userId?: string;
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  planKey?: PaidPlanKey | null;
  stripeCustomerId?: string | null;
  stripeEventCreated?: number;
}): void {
  const row =
    getUserBillingBySubscriptionId(input.stripeSubscriptionId) ??
    (input.userId ? getUserBilling(input.userId) : null);
  if (!row) return;
  if (!shouldApplyStripeEvent(row.stripeLastEventCreated, input.stripeEventCreated ?? 0)) {
    return;
  }
  const watermark = nextWatermark(
    row.stripeLastEventCreated,
    input.stripeEventCreated,
  );
  const planKey = input.planKey ?? row.planKey;
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET
         plan_key = ?,
         stripe_subscription_id = ?,
         stripe_customer_id = COALESCE(?, stripe_customer_id),
         subscription_status = ?,
         current_period_end = ?,
         cancel_at_period_end = ?,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(
      planKey,
      input.stripeSubscriptionId,
      input.stripeCustomerId ?? null,
      input.status,
      input.currentPeriodEnd,
      input.cancelAtPeriodEnd ? 1 : 0,
      watermark,
      nowIso(),
      row.userId,
    );
}

export function cancelSubscriptionByStripeSubscriptionId(
  subscriptionId: string,
  stripeEventCreated?: number,
): void {
  const row = getUserBillingBySubscriptionId(subscriptionId);
  if (!row) return;
  if (!shouldApplyStripeEvent(row.stripeLastEventCreated, stripeEventCreated ?? 0)) {
    return;
  }
  const watermark = nextWatermark(row.stripeLastEventCreated, stripeEventCreated);
  getPlatformDb()
    .prepare(
      `UPDATE user_billing SET
         plan_key = 'free',
         stripe_subscription_id = NULL,
         subscription_status = 'canceled',
         cancel_at_period_end = 0,
         stripe_last_event_created = ?,
         updated_at = ?
       WHERE user_id = ?`,
    )
    .run(watermark, nowIso(), row.userId);
}
