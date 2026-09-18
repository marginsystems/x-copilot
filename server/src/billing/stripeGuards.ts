/**
 * Checkout vs portal guards (same rules as mergestorm: no second sub, no empty portal).
 */
import type { UserBillingRow } from "./billingStore.js";
import {
  hasLiveStripeSubscription,
  hasPaidBillingHistory,
} from "./planResolution.js";

const NON_LIVE = new Set(["canceled", "incomplete_expired"]);

export function portalBlockedForPureFreeUser(
  row: UserBillingRow,
):
  | { blocked: false }
  | { blocked: true; error: "no_billing_history"; message: string } {
  if (hasPaidBillingHistory(row)) return { blocked: false };
  return {
    blocked: true,
    error: "no_billing_history",
    message:
      "You don't have a subscription yet. Use Subscribe on Usage & Billing to start a plan.",
  };
}

export function portalBlockedWithoutStripeSubscription(
  row: UserBillingRow,
):
  | { blocked: false }
  | { blocked: true; error: "no_active_subscription"; message: string } {
  if (hasLiveStripeSubscription(row)) return { blocked: false };
  return {
    blocked: true,
    error: "no_active_subscription",
    message:
      "You don't have a Stripe subscription to manage yet. Use Subscribe to start a plan.",
  };
}

export function checkoutBlockedByExistingSubscription(
  row: UserBillingRow,
):
  | { blocked: false }
  | { blocked: true; subscription_status: string | null; message: string } {
  const subId = row.stripeSubscriptionId?.trim() || null;
  if (!subId) return { blocked: false };
  const status = row.subscriptionStatus?.trim() || null;
  if (status && NON_LIVE.has(status)) return { blocked: false };

  let message: string;
  if (status === "past_due" || status === "unpaid") {
    message =
      "Your subscription payment failed. Update your payment method in Manage billing instead of starting a new checkout.";
  } else if (status === "active" || status === "trialing") {
    message =
      "You already have an active subscription. Change plans in Manage billing.";
  } else {
    message =
      "You already have a Stripe subscription. Manage it instead of starting a new checkout.";
  }
  return { blocked: true, subscription_status: status, message };
}
