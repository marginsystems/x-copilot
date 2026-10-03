import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROACH_NEXT_ID_MAX,
  remoteNextStale,
  parseApproachNextRequest,
  parseApproachNextResponse,
  remoteNextApplies,
  upNextLock,
} from "./approachNext.ts";

await describe("remote approach Next", () => {
  it("applies only to the desk's current Scout card after its reply is detected", () => {
    const lock = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(remoteNextApplies(lock, { fromCardId: "c1" }, true), true);
    assert.equal(remoteNextApplies(lock, { fromCardId: "c1" }, false), false);
    assert.equal(remoteNextApplies(lock, { fromCardId: "c2" }, true), false);
    assert.equal(remoteNextApplies({ phase: "hold", cardId: null, surface: "for_you" }, { fromCardId: "c1" }, true), false);
  }).catch(assert.fail);

  it("reads the request and the relay response", () => {
    assert.deepEqual(parseApproachNextRequest({ fromCardId: " c1 " }), { fromCardId: "c1" });
    assert.deepEqual(parseApproachNextRequest({ forYou: true }), { forYou: true });
    for (const bad of [null, {}, { fromCardId: "" }, { fromCardId: 3 }, { fromCardId: "x".repeat(APPROACH_NEXT_ID_MAX + 1) }, { fromCardId: "c1", forYou: true }]) {
      assert.equal(parseApproachNextRequest(bad), null);
    }
    assert.deepEqual(parseApproachNextResponse({ ok: true, delivered: false }), { delivered: false });
    assert.equal(parseApproachNextResponse({ ok: true }), null);
  }).catch(assert.fail);

  it("applies a For You Next whenever the desk is on its For You card", () => {
    const forYou = { phase: "hold" as const, cardId: null, surface: "for_you" as const };
    const scout = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(remoteNextApplies(forYou, { forYou: true }, false), true);
    assert.equal(remoteNextApplies(scout, { forYou: true }, true), false);
    assert.equal(remoteNextStale(forYou, { forYou: true }), false);
    assert.equal(remoteNextStale(scout, { forYou: true }), true);
    const collidingScout = { ...scout, cardId: "for_you" };
    assert.equal(remoteNextApplies(collidingScout, { fromCardId: "for_you" }, true), true);
    assert.equal(remoteNextStale(collidingScout, { fromCardId: "for_you" }), false);
    assert.equal(remoteNextStale(scout, { fromCardId: "c1" }), false);
    assert.equal(remoteNextStale(scout, { fromCardId: "c2" }), true);
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
