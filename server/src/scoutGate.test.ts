import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  SCOUT_COOLDOWN_MS,
  endScout,
  resetScoutGateForTests,
  tryBeginScout,
} from "./scoutGate.ts";

describe("scoutGate", () => {
  beforeEach(() => {
    resetScoutGateForTests();
  });

  it("allows the first begin and rejects overlap", () => {
    const t0 = 1_000_000;
    assert.equal(tryBeginScout(t0).ok, true);
    const busy = tryBeginScout(t0 + 100);
    assert.equal(busy.ok, false);
    if (!busy.ok) {
      assert.equal(busy.status, 429);
      assert.equal(busy.error, "scout_busy");
    }
  });

  it("enforces cooldown after endScout", () => {
    const t0 = 2_000_000;
    assert.equal(tryBeginScout(t0).ok, true);
    endScout(t0 + 500);
    const early = tryBeginScout(t0 + 500 + SCOUT_COOLDOWN_MS - 1);
    assert.equal(early.ok, false);
    if (!early.ok) {
      assert.equal(early.error, "scout_cooldown");
      assert.match(early.message, /Wait \d+s/);
    }
    assert.equal(tryBeginScout(t0 + 500 + SCOUT_COOLDOWN_MS).ok, true);
    endScout(t0 + 500 + SCOUT_COOLDOWN_MS + 1);
  });
});
