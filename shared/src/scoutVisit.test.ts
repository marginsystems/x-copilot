import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseScoutVisit,
  parseScoutVisitAccepted,
  scoutArriveRun,
  scoutHostWeight,
  scoutLeaveRun,
  scoutSpeaker,
  scoutStageShift,
  scoutVisitEntryEdge,
  scoutVisitorStep,
  SCOUT_STAGE_SHIFT_MAX_PX,
  SCOUT_VISIT,
  SCOUT_VISIT_ACCEPTED,
  SCOUT_VISIT_BACK_AT_MS,
  SCOUT_VISIT_CROSS_MS,
  SCOUT_VISIT_EXIT_AT_MS,
  SCOUT_VISIT_GAP_PX,
  SCOUT_VISIT_GREET_AT_MS,
  SCOUT_VISIT_GREET_MS,
  SCOUT_VISIT_IN_AT_MS,
  SCOUT_VISIT_MAX_GROUND_PX,
  SCOUT_VISIT_OUT_AT_MS,
  SCOUT_VISIT_PANEL_OUT_AT_MS,
  SCOUT_VISIT_RUN_MS,
  SCOUT_VISIT_SPEED,
  SCOUT_VISIT_TOTAL_MS,
} from "./scoutVisit.ts";

await describe("scout visit messages", () => {
  it("accepts only the exact visit type and drops any other field", () => {
    assert.deepEqual(parseScoutVisit({ type: SCOUT_VISIT, extra: 1 }), { type: SCOUT_VISIT, groundFromBottomPx: null });
    assert.equal(parseScoutVisit({ type: "x-copilot:other" }), null);
    assert.equal(parseScoutVisit(null), null);
    assert.equal(parseScoutVisit("x-copilot:scout-visit"), null);
  }).catch(assert.fail);

  it("keeps the ground distance only when it is a finite number in range", () => {
    const ground = (value: unknown) => parseScoutVisit({ type: SCOUT_VISIT, groundFromBottomPx: value })?.groundFromBottomPx;
    assert.equal(ground(58.5), 58.5);
    assert.equal(ground(0), 0);
    assert.equal(ground(SCOUT_VISIT_MAX_GROUND_PX), SCOUT_VISIT_MAX_GROUND_PX);
    for (const bad of [-1, SCOUT_VISIT_MAX_GROUND_PX + 1, Number.NaN, Infinity, -Infinity, "58", null, undefined, {}, [58]]) {
      assert.equal(ground(bad), null, String(bad));
    }
    assert.notEqual(parseScoutVisit({ type: SCOUT_VISIT, groundFromBottomPx: "58" }), null);
  }).catch(assert.fail);

  it("accepts only a left or right side on the accepted message", () => {
    assert.deepEqual(parseScoutVisitAccepted({ type: SCOUT_VISIT_ACCEPTED, side: "left", more: true }), {
      type: SCOUT_VISIT_ACCEPTED,
      side: "left",
    });
    assert.equal(parseScoutVisitAccepted({ type: SCOUT_VISIT_ACCEPTED, side: "up" }), null);
    assert.equal(parseScoutVisitAccepted({ type: SCOUT_VISIT_ACCEPTED }), null);
    assert.equal(parseScoutVisitAccepted({ type: SCOUT_VISIT, side: "left" }), null);
  }).catch(assert.fail);
});

await describe("scout visit timeline", () => {
  const near = (actual: number, expected: number, tolerance = 1e-6) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

  it("chains the crossings: desk edge, gap flight, panel run, greeting, panel run, gap flight, desk run", () => {
    assert.equal(SCOUT_VISIT_CROSS_MS, SCOUT_VISIT_GAP_PX / SCOUT_VISIT_SPEED);
    assert.equal(SCOUT_VISIT_OUT_AT_MS, SCOUT_VISIT_RUN_MS);
    assert.equal(SCOUT_VISIT_IN_AT_MS, SCOUT_VISIT_OUT_AT_MS + SCOUT_VISIT_CROSS_MS);
    assert.equal(SCOUT_VISIT_GREET_AT_MS, SCOUT_VISIT_IN_AT_MS + SCOUT_VISIT_RUN_MS);
    assert.equal(SCOUT_VISIT_EXIT_AT_MS, SCOUT_VISIT_GREET_AT_MS + SCOUT_VISIT_GREET_MS);
    assert.equal(SCOUT_VISIT_PANEL_OUT_AT_MS, SCOUT_VISIT_EXIT_AT_MS + SCOUT_VISIT_RUN_MS);
    assert.equal(SCOUT_VISIT_BACK_AT_MS, SCOUT_VISIT_PANEL_OUT_AT_MS + SCOUT_VISIT_CROSS_MS);
    assert.equal(SCOUT_VISIT_TOTAL_MS, SCOUT_VISIT_BACK_AT_MS + SCOUT_VISIT_RUN_MS);
    assert.ok(SCOUT_VISIT_TOTAL_MS >= 5_000 && SCOUT_VISIT_TOTAL_MS <= 6_000);
  }).catch(assert.fail);

  it("leaves from rest, covers exactly the distance by the crossing and moves at the shared speed there", () => {
    for (const distance of [20, 90, 150, 220, 400, 800]) {
      assert.equal(scoutLeaveRun(0, distance).offset, 0);
      near(scoutLeaveRun(SCOUT_VISIT_RUN_MS, distance).offset, distance);
      const before = scoutLeaveRun(SCOUT_VISIT_RUN_MS - 1, distance).offset;
      const after = scoutLeaveRun(SCOUT_VISIT_RUN_MS + 1, distance).offset;
      near((after - before) / 2, SCOUT_VISIT_SPEED, 0.002);
      near(scoutLeaveRun(SCOUT_VISIT_RUN_MS + 250, distance).offset - distance, SCOUT_VISIT_SPEED * 250);
    }
  }).catch(assert.fail);

  it("never slows or backs up on the way out", () => {
    for (const distance of [20, 150, 400, 800]) {
      let previous = 0;
      let previousStep = 0;
      for (let ms = 0; ms <= SCOUT_VISIT_RUN_MS + 400; ms += 10) {
        const offset = scoutLeaveRun(ms, distance).offset;
        assert.ok(offset >= previous, `${distance} at ${ms}`);
        previousStep = offset - previous;
        previous = offset;
      }
      assert.ok(previousStep >= SCOUT_VISIT_SPEED * 10 - 0.05, `${distance}`);
    }
  }).catch(assert.fail);

  it("arrives at the shared speed, keeps it until fully inside, then decelerates to rest on the spot", () => {
    const size = 64;
    for (const distance of [20, 90, 150, 220, 400]) {
      assert.equal(scoutArriveRun(0, distance, size).offset, 0);
      const cruising = Math.min(size, distance) / SCOUT_VISIT_SPEED;
      for (let ms = -100; ms <= cruising; ms += 7) {
        near(scoutArriveRun(ms, distance, size).offset, SCOUT_VISIT_SPEED * ms);
      }
      let previous = scoutArriveRun(cruising, distance, size).offset;
      for (let ms = cruising + 10; ms <= SCOUT_VISIT_RUN_MS; ms += 10) {
        const offset = scoutArriveRun(ms, distance, size).offset;
        assert.ok(offset >= previous - 1e-9 && offset <= distance + 1e-9, `${distance} at ${ms}`);
        previous = offset;
      }
      assert.equal(scoutArriveRun(SCOUT_VISIT_RUN_MS, distance, size).offset, distance);
      assert.equal(scoutArriveRun(SCOUT_VISIT_RUN_MS + 500, distance, size).offset, distance);
      near(scoutArriveRun(SCOUT_VISIT_RUN_MS, distance, size).offset - scoutArriveRun(SCOUT_VISIT_RUN_MS - 1, distance, size).offset, 0, 0.002);
    }
  }).catch(assert.fail);

  it("approaches from outside the edge in a straight line before arriving", () => {
    assert.equal(scoutArriveRun(-250, 150, 64).offset, -SCOUT_VISIT_SPEED * 250);
    assert.equal(scoutArriveRun(-250, 150, 64).hop, 0);
  }).catch(assert.fail);

  it("is grounded at the crossing and hops in between", () => {
    for (const distance of [150, 400]) {
      assert.equal(scoutLeaveRun(0, distance).hop, 0);
      assert.equal(scoutLeaveRun(SCOUT_VISIT_RUN_MS, distance).hop, 0);
      assert.equal(scoutLeaveRun(SCOUT_VISIT_RUN_MS + 200, distance).hop, 0);
      assert.equal(scoutArriveRun(0, distance, 64).hop, 0);
      assert.equal(scoutArriveRun(100, distance, 64).hop, 0);
      assert.equal(scoutArriveRun(SCOUT_VISIT_RUN_MS, distance, 64).hop, 0);
      assert.ok(scoutLeaveRun(SCOUT_VISIT_RUN_MS - 1, distance).hop < 0.05);
      assert.ok(scoutArriveRun(160 + 1, distance, 64).hop < 0.05);
      const landing = Math.max(...Array.from({ length: 100 }, (_, i) => scoutArriveRun(i * 10, distance, 64).hop));
      assert.ok(landing > 0.9, `${distance}`);
      const peak = Math.max(...Array.from({ length: 100 }, (_, i) => scoutLeaveRun(i * 10, distance).hop));
      assert.ok(peak > 0.95, `${distance}`);
    }
  }).catch(assert.fail);

  it("starts a short run late so it still reaches the edge at the crossing", () => {
    assert.equal(scoutLeaveRun(500, 30).offset, 0);
    assert.ok(scoutLeaveRun(950, 30).offset > 0);
    near(scoutLeaveRun(SCOUT_VISIT_RUN_MS, 30).offset, 30);
  }).catch(assert.fail);

  it("keeps the visitor away until it reaches the panel edge, then enters, greets and exits", () => {
    assert.equal(scoutVisitorStep(SCOUT_VISIT_IN_AT_MS - 1).name, "waiting");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_IN_AT_MS).name, "enter");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_GREET_AT_MS - 1).name, "enter");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_GREET_AT_MS).name, "greet");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_EXIT_AT_MS - 1).name, "greet");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_EXIT_AT_MS).name, "exit");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_TOTAL_MS - 1).name, "exit");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_TOTAL_MS).name, "gone");
  }).catch(assert.fail);

  it("lets the guest speak first and the resident answer", () => {
    assert.equal(scoutSpeaker(scoutVisitorStep(SCOUT_VISIT_GREET_AT_MS + 100)), "guest");
    assert.equal(scoutSpeaker(scoutVisitorStep(SCOUT_VISIT_EXIT_AT_MS - 100)), "resident");
    assert.equal(scoutSpeaker(scoutVisitorStep(0)), null);
    assert.equal(scoutSpeaker(scoutVisitorStep(SCOUT_VISIT_GREET_AT_MS - 1)), null);
  }).catch(assert.fail);

  it("moves the resident aside before the guest arrives and back once the guest has left", () => {
    assert.equal(scoutHostWeight(0), 0);
    assert.equal(scoutHostWeight(SCOUT_VISIT_IN_AT_MS / 2), 0.5);
    assert.equal(scoutHostWeight(SCOUT_VISIT_IN_AT_MS), 1);
    assert.equal(scoutHostWeight(SCOUT_VISIT_GREET_AT_MS), 1);
    assert.equal(scoutHostWeight(SCOUT_VISIT_PANEL_OUT_AT_MS), 1);
    assert.equal(scoutHostWeight(SCOUT_VISIT_PANEL_OUT_AT_MS + SCOUT_VISIT_RUN_MS / 2), 0.5);
    assert.equal(scoutHostWeight(SCOUT_VISIT_TOTAL_MS), 0);
  }).catch(assert.fail);

  it("enters from the edge facing the desk", () => {
    assert.equal(scoutVisitEntryEdge("left"), "right");
    assert.equal(scoutVisitEntryEdge("right"), "left");
  }).catch(assert.fail);
});

await describe("scoutStageShift", () => {
  const room = { roomUpPx: 12, roomDownPx: 20 };

  it("moves the panel stage down when its ground is higher than the desk's and up when lower", () => {
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: 52, ...room }), 12);
    assert.equal(scoutStageShift({ deskGroundPx: 52, ownGroundPx: 40, ...room }), -12);
    assert.equal(scoutStageShift({ deskGroundPx: 50, ownGroundPx: 50, ...room }), 0);
  }).catch(assert.fail);

  it("leaves the layout alone without a usable desk distance", () => {
    for (const deskGroundPx of [null, Number.NaN, Infinity, -4, SCOUT_VISIT_MAX_GROUND_PX + 1]) {
      assert.equal(scoutStageShift({ deskGroundPx, ownGroundPx: 52, ...room }), 0, String(deskGroundPx));
    }
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: Number.NaN, ...room }), 0);
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: -3, ...room }), 0);
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: 52, roomUpPx: Number.NaN, roomDownPx: Infinity }), 0);
  }).catch(assert.fail);

  it("goes as far as the free room around the stage allows and no further", () => {
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: 60, ...room }), 20);
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: 75, ...room }), 20);
    assert.equal(scoutStageShift({ deskGroundPx: 60, ownGroundPx: 48, ...room }), -12);
    assert.equal(scoutStageShift({ deskGroundPx: 60, ownGroundPx: 30, ...room }), -12);
    assert.equal(scoutStageShift({ deskGroundPx: 40, ownGroundPx: 52, roomUpPx: 0, roomDownPx: 0 }), 0);
  }).catch(assert.fail);

  it("never shifts further than the hard limit even with room to spare", () => {
    const wide = { roomUpPx: 500, roomDownPx: 500 };
    assert.equal(scoutStageShift({ deskGroundPx: 10, ownGroundPx: 10 + SCOUT_STAGE_SHIFT_MAX_PX, ...wide }), SCOUT_STAGE_SHIFT_MAX_PX);
    assert.equal(scoutStageShift({ deskGroundPx: 10, ownGroundPx: 11 + SCOUT_STAGE_SHIFT_MAX_PX, ...wide }), 0);
    assert.equal(scoutStageShift({ deskGroundPx: 11 + SCOUT_STAGE_SHIFT_MAX_PX, ownGroundPx: 10, ...wide }), 0);
  }).catch(assert.fail);
});
