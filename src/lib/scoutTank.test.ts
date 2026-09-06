import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SCOUT_TANK_LABEL, SCOUT_TANK_TITLE } from "./scoutTank";

describe("scout tank brand", () => {
  it("keeps the product name on the scouted card", () => {
    assert.equal(SCOUT_TANK_LABEL, "Tank");
    assert.equal(SCOUT_TANK_TITLE, "Scout tank");
  });
});
