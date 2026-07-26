import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SCOUT_SEARCH_TIMELINE,
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
  });
});
