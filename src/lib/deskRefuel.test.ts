import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearScoutTakeoffTried,
  eligibleScoutCards,
  markScoutTakeoffTried,
  readScoutTakeoffTried,
  scoutRefillPending,
  scoutRefillState,
  shouldArmScoutOnBoot,
  shouldArmScoutRefill,
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

describe("Scout refill state", () => {
  it("keeps an armed refill visible while queued, waiting, or flying", () => {
    const refill = {
      armed: true,
      searching: false,
      cooldownRemainingSec: 0,
      scoutCount: 0,
    };
    assert.equal(scoutRefillState(refill), "queued");
    assert.equal(
      scoutRefillState({ ...refill, cooldownRemainingSec: 4 }),
      "waiting",
    );
    assert.equal(
      scoutRefillState({ ...refill, searching: true }),
      "flying",
    );
    assert.equal(scoutRefillPending("queued"), true);
    assert.equal(scoutRefillPending("waiting"), true);
    assert.equal(scoutRefillPending("flying"), true);
  });

  it("distinguishes landed inventory from a terminal empty tank", () => {
    const idle = {
      armed: false,
      searching: false,
      cooldownRemainingSec: 0,
      scoutCount: 1,
    };
    assert.equal(scoutRefillState(idle), "landed");
    assert.equal(
      scoutRefillState({ ...idle, scoutCount: 0 }),
      "terminal_empty",
    );
    assert.equal(scoutRefillPending("landed"), false);
    assert.equal(scoutRefillPending("terminal_empty"), false);
  });

  it("arms after Mark consumes the last usable Scout card", () => {
    assert.equal(shouldArmScoutRefill(0), true);
    assert.equal(shouldArmScoutRefill(1), true);
    assert.equal(shouldArmScoutRefill(2), false);
  });

  it("counts only eligible stock: a retained detected card is not tank", () => {
    const tank = [{ id: "detected" }, { id: "fresh" }, { id: "released" }];
    const eligible = eligibleScoutCards(
      tank,
      new Set(["detected"]),
      new Set(["released"]),
    );
    assert.deepEqual(eligible.map((row) => row.id), ["fresh"]);
    assert.equal(shouldArmScoutRefill(eligible.length), true);
    assert.equal(shouldArmScoutRefill(tank.length), false);
  });
});

describe("shouldArmScoutOnBoot", () => {
  it("arms an empty or low tank when this tab has not tried", () => {
    assert.equal(
      shouldArmScoutOnBoot({
        tankKnown: true,
        handledThisOpen: false,
        usableScoutCount: 0,
        alreadyTried: false,
        searching: false,
      }),
      true,
    );
    assert.equal(
      shouldArmScoutOnBoot({
        tankKnown: true,
        handledThisOpen: false,
        usableScoutCount: 1,
        alreadyTried: false,
        searching: false,
      }),
      true,
    );
  });

  it("ignores the old session flag, but waits for stock and debounces this open", () => {
    const boot = {
      tankKnown: true,
      handledThisOpen: false,
      usableScoutCount: 0,
      alreadyTried: false,
      searching: false,
    };
    assert.equal(
      shouldArmScoutOnBoot({ ...boot, alreadyTried: true }),
      true,
    );
    assert.equal(
      shouldArmScoutOnBoot({ ...boot, usableScoutCount: 2 }),
      false,
    );
    assert.equal(shouldArmScoutOnBoot({ ...boot, searching: true }), false);
    assert.equal(shouldArmScoutOnBoot({ ...boot, tankKnown: false }), false);
    assert.equal(shouldArmScoutOnBoot({ ...boot, handledThisOpen: true }), false);
    assert.equal(shouldArmScoutOnBoot({ ...boot, usableScoutCount: 1, alreadyTried: true }), true);
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
