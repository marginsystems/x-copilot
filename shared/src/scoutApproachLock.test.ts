import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deskApproachState, lockMovedAfterNext, parseScoutApproachLockResponse } from "./scoutApproachLock.ts";

const card = {
  id: "c9",
  conversationId: "conv-9",
  inReplyToId: null,
  surface: "reply",
  author: "@dana",
  url: "https://x.com/dana/status/9",
  text: "hi",
};

await describe("scout approach lock response", () => {
  it("reads a card or an empty lock", () => {
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card }), { card, next: null, state: null });
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card: null }), { card: null, next: null, state: null });
  }).catch(assert.fail);

  it("reads the card the desk would lock after Next, or For You as next", () => {
    const upNext = { ...card, id: "c10" };
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card, next: { card: upNext } }), { card, next: { card: upNext }, state: null });
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card, next: { card: null } }), { card, next: { card: null }, state: null });
  }).catch(assert.fail);

  it("treats a missing or malformed next as unknown and keeps the lock", () => {
    for (const next of [undefined, null, "c10", {}, { card: { id: "" } }]) {
      assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card, next }), { card, next: null, state: null });
    }
  }).catch(assert.fail);

  it("rejects malformed responses", () => {
    for (const bad of [null, {}, { ok: false, card }, { ok: true }, { ok: true, card: { ...card, id: "" } }, { ok: true, card: { ...card, surface: "quote" } }, { ok: true, card: { ...card, url: 3 } }]) {
      assert.equal(parseScoutApproachLockResponse(bad), null);
    }
  }).catch(assert.fail);
});

await describe("lock moved after Next", () => {
  it("after a Scout card, any other card or For You counts as moved", () => {
    assert.equal(lockMovedAfterNext({ fromCardId: "c9" }, card), false);
    assert.equal(lockMovedAfterNext({ fromCardId: "c9" }, { ...card, id: "c10" }), true);
    assert.equal(lockMovedAfterNext({ fromCardId: "c9" }, null), true);
  }).catch(assert.fail);

  it("after For You, only a card counts as moved", () => {
    assert.equal(lockMovedAfterNext({ forYou: true }, null), false);
    assert.equal(lockMovedAfterNext({ forYou: true }, card), true);
  }).catch(assert.fail);
});

await describe("desk approach state", () => {
  const base = { phase: "hold", cardId: null, forYouTask: false, scoutDetected: false, suggestionDetected: false, forYouDetected: false };

  it("names the card the desk is showing and whether the desk detected it", () => {
    assert.deepEqual(deskApproachState({ ...base, forYouTask: true, forYouDetected: true }), { view: "for_you", detected: true });
    assert.deepEqual(deskApproachState({ ...base, phase: "scout_reply", cardId: "c1", scoutDetected: true }), { view: "scout", detected: true });
    assert.deepEqual(deskApproachState({ ...base, phase: "organic_reply", cardId: "s1" }), { view: "suggestion", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "done_for_now" }), { view: "collecting", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "scout_reply" }), { view: "collecting", detected: false });
    assert.deepEqual(deskApproachState({ ...base, phase: "silent_refuel" }), { view: "other", detected: false });
  }).catch(assert.fail);

  it("reads the state from the lock answer and drops a malformed one", () => {
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card: null, state: { view: "collecting", detected: false } })?.state, { view: "collecting", detected: false });
    for (const state of [undefined, null, {}, { view: "nope", detected: false }, { view: "for_you" }]) {
      assert.equal(parseScoutApproachLockResponse({ ok: true, card: null, state })?.state, null);
    }
  }).catch(assert.fail);
});
