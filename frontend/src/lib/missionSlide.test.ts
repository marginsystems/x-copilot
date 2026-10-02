import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { missionSlideKey } from "./missionSlide.ts";

const none = { scout: null, suggestion: null };

await describe("missionSlideKey", () => {
  it("changes when the locked Scout card changes", () => {
    const a = missionSlideKey({ kind: "scout", gate: null }, { ...none, scout: { id: "t1" } });
    const b = missionSlideKey({ kind: "scout", gate: null }, { ...none, scout: { id: "t2" } });
    assert.notEqual(a, b);
  }).catch(assert.fail);

  it("changes when the locked suggestion changes", () => {
    const a = missionSlideKey({ kind: "suggested", gate: null }, { ...none, suggestion: { id: "s1" } });
    const b = missionSlideKey({ kind: "suggested", gate: null }, { ...none, suggestion: { id: "s2" } });
    assert.notEqual(a, b);
  }).catch(assert.fail);

  it("keeps the For You task stable across detection updates", () => {
    assert.equal(
      missionSlideKey({ kind: "for_you", gate: null }, none),
      missionSlideKey({ kind: "for_you", gate: null }, { ...none, suggestion: { id: "s1" } }),
    );
  }).catch(assert.fail);

  it("changes between card kinds", () => {
    assert.notEqual(
      missionSlideKey({ kind: "scout_missing", gate: null }, none),
      missionSlideKey({ kind: "scout", gate: null }, { ...none, scout: { id: "t1" } }),
    );
  }).catch(assert.fail);

  it("separates the link X and settings gates", () => {
    assert.notEqual(
      missionSlideKey({ kind: "gate", gate: "link_x" }, none),
      missionSlideKey({ kind: "gate", gate: "settings" }, none),
    );
  }).catch(assert.fail);
});
