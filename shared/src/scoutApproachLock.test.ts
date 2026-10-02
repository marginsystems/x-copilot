import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseScoutApproachLockResponse } from "./scoutApproachLock.ts";

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
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card }), { card });
    assert.deepEqual(parseScoutApproachLockResponse({ ok: true, card: null }), { card: null });
  }).catch(assert.fail);

  it("rejects malformed responses", () => {
    for (const bad of [null, {}, { ok: false, card }, { ok: true }, { ok: true, card: { ...card, id: "" } }, { ok: true, card: { ...card, surface: "quote" } }, { ok: true, card: { ...card, url: 3 } }]) {
      assert.equal(parseScoutApproachLockResponse(bad), null);
    }
  }).catch(assert.fail);
});
