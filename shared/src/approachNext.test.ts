import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  APPROACH_NEXT_ID_MAX,
  parseApproachNextRequest,
  parseApproachNextResponse,
  remoteNextApplies,
} from "./approachNext.ts";

await describe("remote approach Next", () => {
  it("applies only to the desk's current Scout card after its reply is detected", () => {
    const lock = { phase: "scout_reply" as const, cardId: "c1", surface: null };
    assert.equal(remoteNextApplies(lock, "c1", true), true);
    assert.equal(remoteNextApplies(lock, "c1", false), false);
    assert.equal(remoteNextApplies(lock, "c2", true), false);
    assert.equal(remoteNextApplies({ phase: "hold", cardId: null, surface: "for_you" }, "c1", true), false);
  }).catch(assert.fail);

  it("reads the request and the relay response", () => {
    assert.deepEqual(parseApproachNextRequest({ fromCardId: " c1 " }), { fromCardId: "c1" });
    for (const bad of [null, {}, { fromCardId: "" }, { fromCardId: 3 }, { fromCardId: "x".repeat(APPROACH_NEXT_ID_MAX + 1) }]) {
      assert.equal(parseApproachNextRequest(bad), null);
    }
    assert.deepEqual(parseApproachNextResponse({ ok: true, delivered: false }), { delivered: false });
    assert.equal(parseApproachNextResponse({ ok: true }), null);
  }).catch(assert.fail);
});
