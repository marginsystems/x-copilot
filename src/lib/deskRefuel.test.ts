import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  eligibleScoutCards,
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

await describe("shouldBackgroundScout", () => {
  it("fires only after the caller arms an idle low tank", () => {
    assert.equal(shouldBackgroundScout(ready), true);
    assert.equal(shouldBackgroundScout({ ...ready, phase: "hold" }), true);
  }).catch(assert.fail);

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
  }).catch(assert.fail);

  it("waits while searching, cooling down, or already tried", () => {
    assert.equal(shouldBackgroundScout({ ...ready, searching: true }), false);
    assert.equal(
      shouldBackgroundScout({ ...ready, cooldownRemainingSec: 4 }),
      false,
    );
    assert.equal(shouldBackgroundScout({ ...ready, alreadyTried: true }), false);
  }).catch(assert.fail);

  it("does not fly grounded, unlinked, or without an agenda", () => {
    assert.equal(shouldBackgroundScout({ ...ready, grounded: true }), false);
    assert.equal(shouldBackgroundScout({ ...ready, needsXLink: true }), false);
    assert.equal(shouldBackgroundScout({ ...ready, hasAgenda: false }), false);
  }).catch(assert.fail);

  it("does not scout a tank that still has more than one card", () => {
    assert.equal(
      shouldBackgroundScout({
        ...ready,
        phase: "scout_reply",
        scoutCount: 2,
      }),
      false,
    );
  }).catch(assert.fail);

});

await describe("Scout refill state", () => {
  it("arms after Mark consumes the last usable Scout card", () => {
    assert.equal(shouldArmScoutRefill(0), true);
    assert.equal(shouldArmScoutRefill(1), true);
    assert.equal(shouldArmScoutRefill(2), false);
  }).catch(assert.fail);

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
  }).catch(assert.fail);

});

await describe("shouldArmScoutOnBoot", () => {
  it("arms an empty or low tank on a new opening", () => {
    assert.equal(
      shouldArmScoutOnBoot({
        tankKnown: true,
        handledThisOpen: false,
        usableScoutCount: 0,
        searching: false,
      }),
      true,
    );
    assert.equal(
      shouldArmScoutOnBoot({
        tankKnown: true,
        handledThisOpen: false,
        usableScoutCount: 1,
        searching: false,
      }),
      true,
    );
  }).catch(assert.fail);

  it("waits for stock and debounces this opening", () => {
    const boot = {
      tankKnown: true,
      handledThisOpen: false,
      usableScoutCount: 0,
      searching: false,
    };
    assert.equal(shouldArmScoutOnBoot(boot), true);
    assert.equal(
      shouldArmScoutOnBoot({ ...boot, usableScoutCount: 2 }),
      false,
    );
    assert.equal(shouldArmScoutOnBoot({ ...boot, searching: true }), false);
    assert.equal(shouldArmScoutOnBoot({ ...boot, tankKnown: false }), false);
    assert.equal(shouldArmScoutOnBoot({ ...boot, handledThisOpen: true }), false);
    assert.equal(shouldArmScoutOnBoot({ ...boot, usableScoutCount: 1 }), true);
  }).catch(assert.fail);
});
