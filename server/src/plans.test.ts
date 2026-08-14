import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PAID_PLANS,
  PLAN_CREDIT_LIMITS,
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
    assert.equal(PLAN_CREDIT_LIMITS.free, 250);
    assert.equal(PLAN_CREDIT_LIMITS.pulse, 1500);
    assert.equal(PLAN_CREDIT_LIMITS.radar, 6000);
    assert.equal(PLAN_CREDIT_LIMITS.horizon, 20000);
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
    assert.equal(PAID_PLANS[0].sorties, 4);
    assert.equal(PAID_PLANS[1].sorties, 8);
    assert.equal(PAID_PLANS[2].sorties, 20);
  });
});
