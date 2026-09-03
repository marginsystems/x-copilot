import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldBackgroundScout } from "./deskRefuel.ts";

const ready = {
  phase: "silent_refuel" as const,
  searching: false,
  grounded: false,
  cooldownRemainingSec: 0,
  needsXLink: false,
  hasAgenda: true,
  scoutCount: 0,
  alreadyTried: false,
};

describe("shouldBackgroundScout", () => {
  it("fires on idle silent_refuel or hold with agenda and credits", () => {
    assert.equal(shouldBackgroundScout(ready), true);
    assert.equal(shouldBackgroundScout({ ...ready, phase: "hold" }), true);
  });

  it("fires when the last scouted card is still on the desk", () => {
    assert.equal(
      shouldBackgroundScout({
        ...ready,
        phase: "scout_reply",
        scoutCount: 1,
      }),
      true,
    );
    assert.equal(
      shouldBackgroundScout({ ...ready, phase: "organic_reply" }),
      true,
    );
  });

  it("waits while searching, cooling down, or already tried", () => {
    assert.equal(shouldBackgroundScout({ ...ready, searching: true }), false);
    assert.equal(
      shouldBackgroundScout({ ...ready, cooldownRemainingSec: 4 }),
      false,
    );
    assert.equal(shouldBackgroundScout({ ...ready, alreadyTried: true }), false);
  });

  it("does not fly grounded, unlinked, or without an agenda", () => {
    assert.equal(shouldBackgroundScout({ ...ready, grounded: true }), false);
    assert.equal(shouldBackgroundScout({ ...ready, needsXLink: true }), false);
    assert.equal(shouldBackgroundScout({ ...ready, hasAgenda: false }), false);
  });

  it("does not scout a tank that still has more than one card", () => {
    assert.equal(
      shouldBackgroundScout({
        ...ready,
        phase: "scout_reply",
        scoutCount: 2,
      }),
      false,
    );
  });
});
