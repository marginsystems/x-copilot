import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearScoutTakeoffTried,
  markScoutTakeoffTried,
  readScoutTakeoffTried,
  shouldBackgroundScout,
} from "./deskRefuel.ts";

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
  it("fires only after the caller arms an idle low tank", () => {
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
    assert.equal(
      shouldBackgroundScout({ ...ready, phase: "done_for_now" }),
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

describe("Scout takeoff session gate", () => {
  it("survives refresh until an operator consume path clears it", () => {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    try {
      assert.equal(readScoutTakeoffTried(), false);
      markScoutTakeoffTried();
      assert.equal(readScoutTakeoffTried(), true);
      assert.equal(
        shouldBackgroundScout({ ...ready, alreadyTried: readScoutTakeoffTried() }),
        false,
      );
      clearScoutTakeoffTried();
      assert.equal(readScoutTakeoffTried(), false);
    } finally {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  });
});
