import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserBillingRow } from "./billingStore.ts";
import {
  checkoutBlockedByExistingSubscription,
  portalBlockedForPureFreeUser,
  portalBlockedWithoutStripeSubscription,
} from "./stripeGuards.ts";

function row(over: Partial<UserBillingRow> = {}): UserBillingRow {
  return {
    userId: "u1",
    tenantId: "t1",
    planKey: "free",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    stripeLastEventCreated: 0,
    updatedAt: new Date().toISOString(),
    ...over,
  };
}

describe("stripeGuards", () => {
  it("blocks portal for a pure free user", () => {
    const blocked = portalBlockedForPureFreeUser(row());
    assert.equal(blocked.blocked, true);
  });

  it("blocks a second checkout while a live sub exists", () => {
    const blocked = checkoutBlockedByExistingSubscription(
      row({
        planKey: "pulse",
        stripeSubscriptionId: "sub_1",
        subscriptionStatus: "active",
      }),
    );
    assert.equal(blocked.blocked, true);
  });

  it("allows checkout after cancel", () => {
    const blocked = checkoutBlockedByExistingSubscription(
      row({
        stripeSubscriptionId: "sub_old",
        subscriptionStatus: "canceled",
      }),
    );
    assert.equal(blocked.blocked, false);
  });

  it("blocks portal without a live subscription", () => {
    const blocked = portalBlockedWithoutStripeSubscription(
      row({ stripeCustomerId: "cus_1", planKey: "pulse" }),
    );
    assert.equal(blocked.blocked, true);
  });
});
