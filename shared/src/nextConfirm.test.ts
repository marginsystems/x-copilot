import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  nextAskActive,
  nextClick,
  nextConfirmCopy,
} from "./nextConfirm.ts";

await describe("Next confirmation", () => {
  it("advances on one click when the card is detected", () => {
    assert.deepEqual(nextClick({ detected: true, cardKey: "c1" }), {
      action: "advance",
      ask: null,
    });
  }).catch(assert.fail);

  it("asks instead of advancing while the card is not detected", () => {
    assert.deepEqual(nextClick({ detected: false, cardKey: "c1" }), {
      action: "ask",
      ask: { cardKey: "c1" },
    });
  }).catch(assert.fail);

  it("keeps asking only for the same undetected card", () => {
    const ask = { cardKey: "c1" };
    assert.equal(nextAskActive(ask, { detected: false, cardKey: "c1" }), true);
    assert.equal(nextAskActive(ask, { detected: true, cardKey: "c1" }), false);
    assert.equal(nextAskActive(ask, { detected: false, cardKey: "c2" }), false);
    assert.equal(nextAskActive(null, { detected: false, cardKey: "c1" }), false);
  }).catch(assert.fail);

  it("words the question for a reply or a post", () => {
    assert.equal(nextConfirmCopy("reply"), "No reply detected yet. Skip this card?");
    assert.equal(nextConfirmCopy("post"), "No post detected yet. Skip this card?");
  }).catch(assert.fail);
});
