import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { publishedScoutFlightLine } from "./useScoutRun";

describe("publishedScoutFlightLine", () => {
  it("publishes changing stage copy and live counts", () => {
    const plotting = publishedScoutFlightLine("planning");
    const airborne = publishedScoutFlightLine("searching", {
      candidates: 4,
      bucketSize: 20,
    });

    assert.equal(plotting, "Plotting the route…");
    assert.equal(airborne, "In the air… 4/20");
    assert.notEqual(airborne, plotting);
  });
});
