import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCOUT_TANK_LABEL, SCOUT_TANK_TITLE } from "./scoutTank";

describe("scout tank brand", () => {
  it("keeps the product name on the scouted card", () => {
    assert.equal(SCOUT_TANK_LABEL, "Tank");
    assert.equal(SCOUT_TANK_TITLE, "Scout tank");
  });

  it("uses a fuel bottle mark without battle-tank paths", () => {
    const source = readFileSync(
      new URL("../desk/ScoutTankMark.tsx", import.meta.url),
      "utf8",
    );
    assert.match(source, /<rect x="4" y="8" width="16" height="11"/);
    assert.match(source, /<polyline points="8,8 8,5 14,5 16,8"/);
    assert.doesNotMatch(source, /<path\b/);
    assert.doesNotMatch(source, /M5 10\.5h12|M9\.5 10\.5V8|M9 8h6/);
  });
});
