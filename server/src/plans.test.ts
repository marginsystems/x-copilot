import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_PLAN,
  PAID_PLANS,
  PLAN_CREDIT_LIMITS,
  PLAN_DAILY_ACTIVITY_EVENTS,
  PLAN_DAILY_SORTIES,
  derivePlanState,
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

  it("catalogs Free as $0 with no Stripe product", () => {
    assert.equal(FREE_PLAN.key, "free");
    assert.equal(FREE_PLAN.priceUsd, 0);
    assert.equal(FREE_PLAN.priceLabel, "Free");
    assert.equal(FREE_PLAN.credits, 1500);
    assert.equal(FREE_PLAN.sorties, 1);
    assert.equal(FREE_PLAN.dailyEvents, 15);
    assert.match(FREE_PLAN.blurb, /no credit card/i);
  });

  it("derives free vs paid plan states", () => {
    assert.equal(
      derivePlanState({ planKey: "free", live: false, status: null, creditsCanUse: true }),
      "free_active",
    );
    assert.equal(
      derivePlanState({ planKey: "free", live: false, status: null, creditsCanUse: false }),
      "free_limit_reached",
    );
    assert.equal(
      derivePlanState({
        planKey: "pulse",
        live: true,
        status: "active",
        creditsCanUse: false,
      }),
      "subscription_active",
    );
    assert.equal(
      derivePlanState({
        planKey: "pulse",
        live: true,
        status: "past_due",
        creditsCanUse: true,
      }),
      "past_due",
    );
    assert.equal(
      derivePlanState({
        planKey: "free",
        live: true,
        status: "active",
        creditsCanUse: true,
      }),
      "free_active",
    );
    assert.equal(
      derivePlanState({
        planKey: "free",
        live: true,
        status: "past_due",
        creditsCanUse: false,
      }),
      "free_limit_reached",
    );
  });

  it("keeps plan_state consistent with a paid plan key", () => {
    assert.equal(
      derivePlanState({
        planKey: "horizon",
        live: false,
        status: null,
        creditsCanUse: true,
      }),
      "subscription_active",
    );
    assert.equal(
      derivePlanState({
        planKey: "pulse",
        live: true,
        status: null,
        creditsCanUse: true,
      }),
      "subscription_active",
    );
    assert.equal(
      derivePlanState({
        planKey: "horizon",
        live: true,
        status: "paused",
        creditsCanUse: true,
      }),
      "past_due",
    );
    assert.equal(
      derivePlanState({
        planKey: "radar",
        live: true,
        status: "incomplete",
        creditsCanUse: true,
      }),
      "past_due",
    );
    assert.equal(
      derivePlanState({
        planKey: "free",
        live: true,
        status: "paused",
        creditsCanUse: true,
      }),
      "free_active",
    );
    assert.equal(
      derivePlanState({
        planKey: "free",
        live: true,
        status: "incomplete",
        creditsCanUse: false,
      }),
      "free_limit_reached",
    );
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
