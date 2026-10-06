import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROACH_NEXT_ID_MAX,
  approachNextEvent,
  parseApproachActionNotice,
  remoteNextStale,
  parseApproachNextRequest,
  parseApproachNextResponse,
  remoteNextApplies,
  upNextLock,
} from "./approachNext.ts";

await describe("remote approach Next", () => {
  it("applies only to the desk's current Scout card, detected or not", () => {
    const lock = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(remoteNextApplies(lock, { fromCardId: "c1" }), true);
    assert.equal(remoteNextApplies(lock, { fromCardId: "c2" }), false);
    assert.equal(remoteNextApplies({ phase: "hold", cardId: null, surface: "for_you" }, { fromCardId: "c1" }), false);
  }).catch(assert.fail);

  it("reads the request and the relay response", () => {
    assert.deepEqual(parseApproachNextRequest({ fromCardId: " c1 " }), { fromCardId: "c1" });
    assert.deepEqual(parseApproachNextRequest({ forYou: true }), { forYou: true });
    for (const bad of [null, {}, { fromCardId: "" }, { fromCardId: 3 }, { fromCardId: "x".repeat(APPROACH_NEXT_ID_MAX + 1) }, { fromCardId: "c1", forYou: true }]) {
      assert.equal(parseApproachNextRequest(bad), null);
    }
    assert.deepEqual(parseApproachNextResponse({ ok: true, delivered: false }), { delivered: false, advanced: false });
    assert.deepEqual(parseApproachNextResponse({ ok: true, delivered: false, advanced: true }), { delivered: false, advanced: true });
    assert.equal(parseApproachNextResponse({ ok: true }), null);
  }).catch(assert.fail);

  it("applies a For You Next whenever the desk is on its For You card", () => {
    const forYou = { phase: "hold" as const, cardId: null, surface: "for_you" as const };
    const scout = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(remoteNextApplies(forYou, { forYou: true }), true);
    assert.equal(remoteNextApplies(scout, { forYou: true }), false);
    assert.equal(remoteNextStale(forYou, { forYou: true }), false);
    assert.equal(remoteNextStale(scout, { forYou: true }), true);
    const collidingScout = { ...scout, cardId: "for_you" };
    assert.equal(remoteNextApplies(collidingScout, { fromCardId: "for_you" }), true);
    assert.equal(remoteNextStale(collidingScout, { fromCardId: "for_you" }), false);
    assert.equal(remoteNextStale(scout, { fromCardId: "c1" }), false);
    assert.equal(remoteNextStale(scout, { fromCardId: "c2" }), true);
  }).catch(assert.fail);
});

await describe("remote approach Skip and Not interested", () => {
  it("reads the action strictly, and an absent or explicit next as a plain Next", () => {
    assert.deepEqual(parseApproachNextRequest({ fromCardId: " c1 ", action: "skip", kind: "scout" }), { fromCardId: "c1", action: "skip", kind: "scout" });
    assert.deepEqual(parseApproachNextRequest({ fromCardId: "c1", action: "dismiss", kind: "suggestion" }), { fromCardId: "c1", action: "dismiss", kind: "suggestion" });
    assert.deepEqual(parseApproachNextRequest({ fromCardId: "c1", action: "next" }), { fromCardId: "c1" });
    assert.deepEqual(parseApproachNextRequest({ forYou: true, action: "next" }), { forYou: true });
    for (const bad of [
      { fromCardId: "c1", action: "mark" },
      { fromCardId: "c1", action: null },
      { fromCardId: "c1", action: "SKIP" },
      { fromCardId: "c1", action: "skip" },
      { fromCardId: "c1", action: "skip", kind: "for_you" },
      { forYou: true, action: "skip" },
      { forYou: true, action: "dismiss" },
    ]) {
      assert.equal(parseApproachNextRequest(bad), null);
    }
  }).catch(assert.fail);

  it("names the desk event each request applies", () => {
    assert.deepEqual(approachNextEvent({ fromCardId: "c1" }), { type: "next" });
    assert.deepEqual(approachNextEvent({ fromCardId: "c1", action: "skip", kind: "scout" }), { type: "skip" });
    assert.deepEqual(approachNextEvent({ fromCardId: "c1", action: "dismiss", kind: "suggestion" }), { type: "dismiss" });
    assert.deepEqual(approachNextEvent({ forYou: true }), { type: "next" });
  }).catch(assert.fail);

  it("applies only to the locked Scout or suggested card, never another card", () => {
    const scout = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    const suggested = { phase: "organic_reply" as const, cardId: "s1", surface: null };
    const forYou = { phase: "hold" as const, cardId: null, surface: "for_you" as const };
    assert.equal(remoteNextApplies(scout, { fromCardId: "c1", action: "skip", kind: "scout" }), true);
    assert.equal(remoteNextApplies(scout, { fromCardId: "c2", action: "skip", kind: "scout" }), false);
    assert.equal(remoteNextApplies(suggested, { fromCardId: "s1", action: "dismiss", kind: "suggestion" }), true);
    assert.equal(remoteNextApplies(suggested, { fromCardId: "s2", action: "dismiss", kind: "suggestion" }), false);
    assert.equal(remoteNextApplies(suggested, { fromCardId: "s1" }), false);
    assert.equal(remoteNextApplies(forYou, { fromCardId: "c1", action: "skip", kind: "scout" }), false);
    assert.equal(remoteNextStale(suggested, { fromCardId: "s1", action: "skip", kind: "suggestion" }), false);
    assert.equal(remoteNextStale(suggested, { fromCardId: "c1", action: "skip", kind: "suggestion" }), true);
  }).catch(assert.fail);

  it("reads the desk's history notice", () => {
    assert.deepEqual(
      parseApproachActionNotice({ action: "skip", fromCardId: "c1", kind: "scout" }),
      { action: "skip", fromCardId: "c1", kind: "scout" },
    );
    assert.deepEqual(
      parseApproachActionNotice({ action: "dismiss", fromCardId: "s1", kind: "suggestion" }),
      { action: "dismiss", fromCardId: "s1", kind: "suggestion" },
    );
    for (const bad of [null, { action: "next", fromCardId: "c1", kind: "scout" }, { action: "skip", fromCardId: "", kind: "scout" }, { action: "skip", fromCardId: "c1", kind: "for_you" }]) {
      assert.equal(parseApproachActionNotice(bad), null);
    }
  }).catch(assert.fail);
});

await describe("up next lock", () => {
  const inventory = { scoutId: "c2", suggestionId: null, canPresentForYou: true };

  it("names the Scout card a For You Next would lock", () => {
    assert.deepEqual(upNextLock({ phase: "hold", cardId: null, surface: "for_you" }, inventory), {
      phase: "scout_reply",
      cardId: "c2",
      surface: null,
    });
  }).catch(assert.fail);

  it("names what follows the locked Scout card", () => {
    const lock = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(upNextLock(lock, { ...inventory, suggestionId: "s1" })?.cardId, "s1");
    assert.equal(upNextLock(lock, { ...inventory, scoutId: null })?.surface, "for_you");
  }).catch(assert.fail);

  it("names nothing for a card a remote Next cannot move", () => {
    assert.equal(upNextLock({ phase: "organic_reply", cardId: "s1", surface: null }, inventory), null);
    assert.equal(upNextLock({ phase: "scout_reply", cardId: null, surface: null }, inventory), null);
    assert.equal(upNextLock({ phase: "done_for_now", cardId: null, surface: null }, inventory), null);
  }).catch(assert.fail);
});
