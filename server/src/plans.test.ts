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
});
