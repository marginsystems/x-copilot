import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseScoutVisit,
  parseScoutVisitAccepted,
  scoutHostWeight,
  scoutSpeaker,
  scoutVisitEntryEdge,
  scoutVisitorStep,
  scoutVisitPhase,
  SCOUT_VISIT,
  SCOUT_VISIT_ACCEPTED,
  SCOUT_VISIT_ENTER_MS,
  SCOUT_VISIT_GREET_MS,
  SCOUT_VISIT_LEAVE_MS,
  SCOUT_VISIT_RETURN_MS,
  SCOUT_VISIT_STAY_MS,
  SCOUT_VISIT_TOTAL_MS,
} from "./scoutVisit.ts";

await describe("scout visit messages", () => {
  it("accepts only the exact visit type and drops any other field", () => {
    assert.deepEqual(parseScoutVisit({ type: SCOUT_VISIT, extra: 1 }), { type: SCOUT_VISIT });
    assert.equal(parseScoutVisit({ type: "x-copilot:other" }), null);
    assert.equal(parseScoutVisit(null), null);
    assert.equal(parseScoutVisit("x-copilot:scout-visit"), null);
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
  it("adds up to the shared leave, stay and return times", () => {
    assert.equal(SCOUT_VISIT_STAY_MS, 3_600);
    assert.equal(SCOUT_VISIT_TOTAL_MS, SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS + SCOUT_VISIT_RETURN_MS);
  }).catch(assert.fail);

  it("walks the desk Scout through leave, stay, return and done", () => {
    assert.deepEqual(scoutVisitPhase(0), { name: "leave", progress: 0 });
    assert.equal(scoutVisitPhase(450).progress, 0.5);
    assert.equal(scoutVisitPhase(SCOUT_VISIT_LEAVE_MS).name, "stay");
    assert.equal(scoutVisitPhase(SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS - 1).name, "stay");
    assert.equal(scoutVisitPhase(SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS).name, "return");
    assert.equal(scoutVisitPhase(SCOUT_VISIT_TOTAL_MS).name, "done");
    assert.equal(scoutVisitPhase(-50).progress, 0);
  }).catch(assert.fail);

  it("keeps the visitor away until the desk Scout has left, then enters, greets and exits", () => {
    assert.equal(scoutVisitorStep(SCOUT_VISIT_LEAVE_MS - 1).name, "waiting");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_LEAVE_MS).name, "enter");
    const greetStart = SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_ENTER_MS;
    assert.equal(scoutVisitorStep(greetStart).name, "greet");
    const exitStart = greetStart + SCOUT_VISIT_GREET_MS;
    assert.equal(scoutVisitorStep(exitStart - 1).name, "greet");
    assert.equal(scoutVisitorStep(exitStart).name, "exit");
    assert.equal(scoutVisitorStep(SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS).name, "gone");
  }).catch(assert.fail);

  it("lets the guest speak first and the resident answer", () => {
    const greetStart = SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_ENTER_MS;
    assert.equal(scoutSpeaker(scoutVisitorStep(greetStart + 100)), "guest");
    assert.equal(scoutSpeaker(scoutVisitorStep(greetStart + SCOUT_VISIT_GREET_MS - 100)), "resident");
    assert.equal(scoutSpeaker(scoutVisitorStep(0)), null);
    assert.equal(scoutSpeaker(scoutVisitorStep(greetStart - 1)), null);
  }).catch(assert.fail);

  it("moves the resident aside while the guest is out and back afterwards", () => {
    assert.equal(scoutHostWeight(0), 0);
    assert.equal(scoutHostWeight(SCOUT_VISIT_LEAVE_MS / 2), 0.5);
    assert.equal(scoutHostWeight(2_000), 1);
    assert.equal(scoutHostWeight(SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS + SCOUT_VISIT_RETURN_MS / 2), 0.5);
    assert.equal(scoutHostWeight(SCOUT_VISIT_TOTAL_MS), 0);
  }).catch(assert.fail);

  it("enters from the edge facing the desk", () => {
    assert.equal(scoutVisitEntryEdge("left"), "right");
    assert.equal(scoutVisitEntryEdge("right"), "left");
  }).catch(assert.fail);
});
