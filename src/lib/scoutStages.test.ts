import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCOUT_SEARCH_TIMELINE,
  formatScoutFailure,
  isScoutGateError,
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

  it("returns Scout-branded copy", () => {
    assert.match(scoutStageMessage("planning"), /^Scout /);
    assert.match(scoutStageMessage("triaging"), /bait/);
    assert.match(scoutStageMessage("partial"), /cool/i);
  });

  it("treats 429 cooldown/busy as soft gate errors", () => {
    assert.equal(
      isScoutGateError(429, { error: "scout_cooldown", message: "Wait 12s before searching again." }),
      true,
    );
    assert.equal(
      isScoutGateError(409, { error: "scout_busy" }),
      true,
    );
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
