import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groundedHint, nextPlanLabel } from "./upgradeCta.ts";

describe("upgrade CTAs", () => {
  it("names the next paid desk", () => {
    assert.equal(nextPlanLabel(undefined), "Pulse");
    assert.equal(nextPlanLabel("free"), "Pulse");
    assert.equal(nextPlanLabel("pulse"), "Radar");
    assert.equal(nextPlanLabel("radar"), "Horizon");
    assert.equal(nextPlanLabel("horizon"), null);
  });

  it("points Grounded copy at the next plan", () => {
    assert.match(
      groundedHint({ limit: 1, planKey: "free" }),
      /1 sortie used today/,
    );
    assert.match(groundedHint({ limit: 1, planKey: "free" }), /Pulse raises this/);
    assert.match(
      groundedHint({ limit: 5, planKey: "pulse" }),
      /5 sorties used today/,
    );
    assert.equal(
      groundedHint({ limit: 25, planKey: "horizon" }).includes("raises this"),
      false,
    );
  });
});
