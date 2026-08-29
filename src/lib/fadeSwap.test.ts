import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fadeSwapShouldAnimate, flightBase } from "./fadeSwap.ts";

describe("fadeSwapShouldAnimate", () => {
  it("animates takeoff stage copy", () => {
    assert.equal(
      fadeSwapShouldAnimate("Plotting the route…", "In the air…"),
      true,
    );
    assert.equal(
      fadeSwapShouldAnimate(
        "On the ground — set an agenda and take off.",
        "Plotting the route…",
      ),
      true,
    );
    assert.equal(fadeSwapShouldAnimate("In the air…", "Landed."), true);
  });

  it("leaves hold-short seconds and live counts instant", () => {
    assert.equal(fadeSwapShouldAnimate("Hold short 12s.", "Hold short 11s."), false);
    assert.equal(
      fadeSwapShouldAnimate("Plotting the route…", "Plotting the route… 4/20"),
      false,
    );
    assert.equal(
      fadeSwapShouldAnimate("Picking the approach… 2/5", "Picking the approach… 3/5"),
      false,
    );
    assert.equal(fadeSwapShouldAnimate("In the air…", "In the air…"), false);
  });

  it("strips only the trailing count so the swap key stays stable across ticks", () => {
    assert.equal(flightBase("Hold short 15s."), flightBase("Hold short 14s."));
    assert.equal(
      flightBase("In the air… 1/20"),
      flightBase("In the air… 2/20"),
    );
    assert.equal(flightBase("Plotting the route… 4/20"), "Plotting the route…");
    assert.notEqual(flightBase("In the air… 1/20"), flightBase("Hold short 15s."));
  });
});
