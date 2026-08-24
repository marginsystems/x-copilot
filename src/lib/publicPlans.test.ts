import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_PLANS } from "./publicPlans.ts";

describe("PUBLIC_PLANS", () => {
  it("lists four offers from Free through Horizon at $0–$99", () => {
    assert.deepEqual(
      PUBLIC_PLANS.map((plan) => plan.key),
      ["free", "pulse", "radar", "horizon"],
    );
    const prices = PUBLIC_PLANS.map((plan) => plan.priceUsd);
    assert.equal(Math.min(...prices), 0);
    assert.equal(Math.max(...prices), 99);
    assert.equal(PUBLIC_PLANS.length, 4);
  });

  it("shows daily suggest caps on every plan", () => {
    for (const plan of PUBLIC_PLANS) {
      assert.ok(plan.suggests >= 10);
      assert.ok(plan.sorties >= 1);
    }
  });
});
