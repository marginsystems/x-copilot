import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { UserBillingRow } from "./billingStore.ts";
import {
  FIRST_WEEK_MS,
  effectivePlanKey,
  firstWeekPulseActive,
  firstWeekPulseNotice,
  resolvePlan,
} from "./planResolution.ts";

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
    grantPlanKey: null,
    grantCreatedAt: null,
    grantCreatedBy: null,
    userCreatedAt: null,
    ...over,
  };
}

const created = "2026-08-25T00:00:00.000Z";
const day6 = new Date("2026-08-30T23:59:59.000Z");
const day7 = new Date("2026-09-01T00:00:00.000Z");

describe("first-week Pulse", () => {
  it("is active until the 7th UTC day, then Free", () => {
    assert.equal(firstWeekPulseActive(created, day6), true);
    assert.equal(firstWeekPulseActive(created, day7), false);
    assert.equal(firstWeekPulseActive(null, day6), false);
    assert.equal(firstWeekPulseActive("nope", day6), false);
    assert.equal(FIRST_WEEK_MS, 7 * 24 * 60 * 60 * 1000);
  });

  it("gives Pulse limits to a new free account", () => {
    const resolved = resolvePlan(row({ userCreatedAt: created }), "a@b.com", day6);
    assert.equal(resolved.planKey, "pulse");
    assert.equal(resolved.reason, "first_week");
    assert.equal(resolved.firstWeekEndsAt, "2026-09-01T00:00:00.000Z");
    assert.match(firstWeekPulseNotice(resolved.firstWeekEndsAt!), /September 1, 2026/);
  });

  it("drops to Free after the week", () => {
    assert.equal(
      effectivePlanKey(row({ userCreatedAt: created }), "a@b.com", day7),
      "free",
    );
  });

  it("lets live Stripe, admin, and grants win", () => {
    assert.equal(
      resolvePlan(
        row({
          userCreatedAt: created,
          planKey: "radar",
          stripeSubscriptionId: "sub_1",
          subscriptionStatus: "active",
        }),
        "a@b.com",
        day6,
      ).reason,
      "stripe",
    );
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "ops@example.com";
    try {
      assert.equal(
        resolvePlan(row({ userCreatedAt: created }), "ops@example.com", day6).reason,
        "admin",
      );
    } finally {
      if (prev === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
    assert.equal(
      resolvePlan(
        row({ userCreatedAt: created, grantPlanKey: "horizon" }),
        "a@b.com",
        day6,
      ).planKey,
      "horizon",
    );
  });
});
