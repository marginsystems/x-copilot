import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCOUT_SEARCH_TIMELINE,
  SCOUT_STAGE_RANK,
  formatScoutFailure,
  isScoutGateError,
  scoutFlightLine,
  scoutStageMessage,
} from "./scoutStages.ts";

describe("scoutStages", () => {
  it("has a four-step search timeline before done", () => {
    assert.deepEqual(SCOUT_SEARCH_TIMELINE, [
      "planning",
      "searching",
      "filtering",
      "triaging",
    ]);
  });

  it("ranks stages so the one-line status never rewinds", () => {
    for (let i = 1; i < SCOUT_SEARCH_TIMELINE.length; i += 1) {
      assert.ok(
        SCOUT_STAGE_RANK[SCOUT_SEARCH_TIMELINE[i]] >
          SCOUT_STAGE_RANK[SCOUT_SEARCH_TIMELINE[i - 1]],
      );
    }
    assert.ok(
      SCOUT_STAGE_RANK.partial < SCOUT_STAGE_RANK.triaging,
      "partial must rank below triaging so a refill never rewinds the flight line",
    );
    for (const terminal of ["done", "error"] as const) {
      assert.ok(
        SCOUT_STAGE_RANK[terminal] > SCOUT_STAGE_RANK.triaging,
        `${terminal} must outrank triaging so the ticker never overwrites it`,
      );
    }
  });

  it("returns flight-style stage copy", () => {
    assert.match(scoutStageMessage("planning"), /route/i);
    assert.match(scoutStageMessage("searching"), /air/i);
    assert.match(scoutStageMessage("done"), /Landed/);
  });

  it("appends cool or candidate counts on the one-line flight status", () => {
    assert.equal(scoutFlightLine("planning"), "Plotting the route…");
    assert.equal(
      scoutFlightLine("searching", { candidates: 4, bucketSize: 20 }),
      "In the air… 4/20",
    );
    assert.equal(
      scoutFlightLine("triaging", { cool: 2, target: 5 }),
      "Picking the approach… 2/5",
    );
    assert.equal(scoutFlightLine("done", { cool: 5, target: 5 }), "Landed.");
  });

  it("treats 429 cooldown/busy as soft gate errors", () => {
    assert.equal(
      isScoutGateError(429, { error: "scout_cooldown", message: "Wait 12s before searching again." }),
      true,
    );
    assert.equal(
      isScoutGateError(429, { error: "scout_busy" }),
      true,
    );
    assert.equal(isScoutGateError(429, { error: "scout_daily_limit" }), true);
    assert.equal(isScoutGateError(402, { error: "credits_exhausted" }), true);
    assert.equal(isScoutGateError(500, { error: "deepseek_error" }), false);
  });

  it("formats hard failures with Scout failed prefix", () => {
    assert.equal(
      formatScoutFailure("stream ended without results"),
      "Scout failed: stream ended without results",
    );
    assert.equal(
      formatScoutFailure("Wait 12s before searching again.", { soft: true }),
      "Wait 12s before searching again.",
    );
  });
});
