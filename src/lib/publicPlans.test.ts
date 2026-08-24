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

  it("pins each plan's numbers to server/src/plans.ts", () => {
    assert.deepEqual(
      PUBLIC_PLANS.map((plan) => ({
        credits: plan.credits,
        sorties: plan.sorties,
        watch: plan.watch,
        suggests: plan.suggests,
      })),
      [
        { credits: 1_500, sorties: 1, watch: 15, suggests: 10 },
        { credits: 6_000, sorties: 5, watch: 50, suggests: 20 },
        { credits: 18_000, sorties: 10, watch: 120, suggests: 30 },
        { credits: 40_000, sorties: 25, watch: 250, suggests: 40 },
      ],
    );
  });
});
