import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveDetectScreenName } from "./detectReply.ts";
import { normalizeXHandle, parseXHandle } from "./xHandle.ts";

describe("parseXHandle", () => {
  it("strips @ and accepts legal handles", () => {
    assert.equal(parseXHandle("@MarginSystems"), "MarginSystems");
    assert.equal(parseXHandle("  a_b1  "), "a_b1");
    assert.equal(normalizeXHandle("@@foo"), "foo");
  });

  it("rejects empty, overlong, or illegal characters", () => {
    assert.equal(parseXHandle(""), null);
    assert.equal(parseXHandle("@"), null);
    assert.equal(parseXHandle("thisnameistoolong1"), null);
    assert.equal(parseXHandle("bad-name"), null);
    assert.equal(parseXHandle("has space"), null);
    assert.equal(parseXHandle(1), null);
  });
});

describe("resolveDetectScreenName", () => {
  it("uses only the signed-in user's handle", () => {
    assert.equal(resolveDetectScreenName("@alice"), "alice");
    assert.equal(resolveDetectScreenName(null), null);
    assert.equal(resolveDetectScreenName(""), null);
  });
});
