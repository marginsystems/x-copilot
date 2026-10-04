import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { approachInventory, nextApproachStep, type ApproachStock } from "./approachSelector.ts";

const reply = (id: string, targetId: string) => ({ id, kind: "reply" as const, targetId, targetUrl: null });
const post = (id: string) => ({ id, kind: "post" as const, targetId: null, targetUrl: null });

function stock(patch: Partial<ApproachStock> = {}): ApproachStock {
  return {
    scoutIds: ["a", "b", "c"],
    suggestions: [],
    interactedIds: [],
    history: [],
    releasedIds: [],
    gate: null,
    scoutReplyDone: false,
    originalMission: null,
    ...patch,
  };
}

const forYou = { phase: "hold" as const, cardId: null, surface: "for_you" as const };
const scoutLock = (cardId: string | null) => ({ phase: "scout_reply" as const, cardId, surface: null });

await describe("approach inventory", async () => {
  await it("offers the first Scout card not replied to, released or currently locked", () => {
    assert.equal(approachInventory(stock(), null, false).scoutId, "a");
    assert.equal(approachInventory(stock(), "a", false).scoutId, "b");
    assert.equal(approachInventory(stock({ interactedIds: ["a"], releasedIds: ["b"] }), null, false).scoutId, "c");
    assert.equal(approachInventory(stock({ interactedIds: ["a", "b", "c"] }), null, false).scoutId, null);
  });

  await it("offers a suggestion whose target was not already replied to, and never a released one", () => {
    const suggestions = [reply("s1", "100"), reply("s2", "200")];
    assert.equal(approachInventory(stock({ suggestions }), null, false).suggestionId, "s1");
    assert.equal(approachInventory(stock({ suggestions, interactedIds: ["100"] }), null, false).suggestionId, "s2");
    assert.equal(approachInventory(stock({ suggestions, releasedIds: ["s1"] }), null, false).suggestionId, "s2");
    assert.equal(approachInventory(stock({ suggestions }), "s1", false).suggestionId, "s2");
  });

  await it("offers an original only once it is earned and the mission is still open", () => {
    const open = { progress: 0, target: 1, completed: false };
    const suggestions = [post("p1")];
    assert.equal(approachInventory(stock({ suggestions, originalMission: open }), null, false).suggestionId, null);
    assert.equal(approachInventory(stock({ suggestions, originalMission: open }), null, true).suggestionId, "p1");
    assert.equal(approachInventory(stock({ suggestions, originalMission: open, scoutReplyDone: true }), null, false).suggestionId, "p1");
    assert.equal(approachInventory(stock({ suggestions, scoutReplyDone: true }), null, false).suggestionId, null);
  });

  await it("cannot present For You while a gate is up", () => {
    assert.deepEqual(approachInventory(stock({ gate: "link_x" }), null, false), {
      scoutId: "a",
      suggestionId: null,
      canPresentForYou: false,
      gate: "link_x",
    });
    assert.equal(approachInventory(stock(), null, false).canPresentForYou, true);
  });
});

await describe("next approach step", async () => {
  await it("moves from For You to the first Scout card", () => {
    assert.deepEqual(nextApproachStep(stock(), forYou), { lock: scoutLock("a"), releasedIds: [] });
  });

  await it("releases the card it leaves so it is not offered again", () => {
    const step = nextApproachStep(stock({ suggestions: [reply("s1", "100")] }), scoutLock("a"));
    assert.deepEqual(step, { lock: { phase: "organic_reply", cardId: "s1", surface: null }, releasedIds: ["a"] });
    assert.equal(approachInventory(stock({ releasedIds: step?.releasedIds ?? [] }), null, false).scoutId, "b");
  });

  await it("goes to For You after a Scout card when there is no suggestion", () => {
    assert.deepEqual(nextApproachStep(stock(), scoutLock("a"))?.lock, {
      phase: "silent_refuel",
      cardId: null,
      surface: "for_you",
    });
  });

  await it("goes to Collecting from For You when nothing is in stock", () => {
    assert.deepEqual(nextApproachStep(stock({ scoutIds: [] }), forYou)?.lock, {
      phase: "done_for_now",
      cardId: null,
      surface: null,
    });
  });

  await it("stays put when Collecting has nothing to move to", () => {
    const collecting = { phase: "done_for_now" as const, cardId: null, surface: null };
    assert.equal(nextApproachStep(stock({ scoutIds: [] }), collecting), null);
    assert.equal(nextApproachStep(stock({ scoutIds: [] }), scoutLock(null)), null);
  });
});
