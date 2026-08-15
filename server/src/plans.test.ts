import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PAID_PLANS,
  PLAN_CREDIT_LIMITS,
  PLAN_DAILY_ACTIVITY_EVENTS,
  PLAN_DAILY_SORTIES,
  isPaidPlanKey,
  isPlanKey,
  planDisplayName,
} from "./plans.ts";

describe("plans", () => {
  it("has three paid desks wrapping post-read credits", () => {
    assert.deepEqual(
      PAID_PLANS.map((p) => p.key),
      ["pulse", "radar", "horizon"],
    );
    assert.equal(PLAN_CREDIT_LIMITS.free, 1500);
    assert.equal(PLAN_CREDIT_LIMITS.pulse, 6000);
    assert.equal(PLAN_CREDIT_LIMITS.radar, 18000);
    assert.equal(PLAN_CREDIT_LIMITS.horizon, 40000);
    assert.deepEqual(PLAN_DAILY_SORTIES, {
      free: 1,
      pulse: 5,
      radar: 10,
      horizon: 25,
    });
    assert.deepEqual(PLAN_DAILY_ACTIVITY_EVENTS, {
      free: 15,
      pulse: 50,
      radar: 120,
      horizon: 250,
    });
  });

  it("narrows plan keys", () => {
    assert.equal(isPlanKey("pulse"), true);
    assert.equal(isPaidPlanKey("free"), false);
    assert.equal(isPaidPlanKey("horizon"), true);
    assert.equal(planDisplayName("pulse"), "Pulse");
    assert.equal(planDisplayName("free"), "Free");
  });

  it("uses Stripe Dashboard product names x-copilot Pulse/Radar/Horizon", () => {
    assert.deepEqual(
      PAID_PLANS.map((p) => p.stripeProductName),
      ["x-copilot Pulse", "x-copilot Radar", "x-copilot Horizon"],
    );
    assert.equal(PAID_PLANS[0].sorties, 5);
    assert.equal(PAID_PLANS[1].sorties, 10);
    assert.equal(PAID_PLANS[2].sorties, 25);
  });
});
