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

  it("allows the first begin and rejects overlap for the same user", () => {
    const t0 = 1_000_000;
    assert.equal(tryBeginScout("a", t0).ok, true);
    const busy = tryBeginScout("a", t0 + 100);
    assert.equal(busy.ok, false);
    if (!busy.ok) {
      assert.equal(busy.status, 429);
      assert.equal(busy.error, "scout_busy");
    }
  });

  it("does not 429 another user while one user's run is active", () => {
    const t0 = 1_000_000;
    assert.equal(tryBeginScout("a", t0).ok, true);
    assert.equal(tryBeginScout("b", t0 + 100).ok, true);
    endScout("b", t0 + 200);
    // A is still running; B's finish does not release A's lock.
    assert.equal(tryBeginScout("a", t0 + 300).ok, false);
    endScout("a", t0 + 400);
  });

  it("enforces cooldown after endScout per user", () => {
    const t0 = 2_000_000;
    assert.equal(tryBeginScout("a", t0).ok, true);
    endScout("a", t0 + 500);
    const early = tryBeginScout("a", t0 + 500 + SCOUT_COOLDOWN_MS - 1);
    assert.equal(early.ok, false);
    if (!early.ok) {
      assert.equal(early.error, "scout_cooldown");
      assert.match(early.message, /Wait \d+s/);
    }
    // B has no cooldown from A's finish.
    assert.equal(tryBeginScout("b", t0 + 501).ok, true);
    assert.equal(tryBeginScout("a", t0 + 500 + SCOUT_COOLDOWN_MS).ok, true);
    endScout("a", t0 + 500 + SCOUT_COOLDOWN_MS + 1);
  });

  it("rejects an empty userId", () => {
    assert.throws(() => tryBeginScout(" "), /userId is required/);
  });

  it("resetScoutGateForTests clears every user and can seed one", () => {
    assert.equal(tryBeginScout("a").ok, true);
    resetScoutGateForTests();
    assert.equal(tryBeginScout("a").ok, true);
    resetScoutGateForTests({ userId: "a", active: true });
    assert.equal(tryBeginScout("a").ok, false);
    assert.equal(tryBeginScout("b").ok, true);
  });
});
