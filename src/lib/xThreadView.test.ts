import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  displayHandle,
  handleInitial,
  hasParentContext,
  parentKind,
} from "./xThreadView.ts";

describe("xThreadView helpers", () => {
  it("normalizes handles and initials", () => {
    assert.equal(displayHandle("@chris_southgate"), "chris_southgate");
    assert.equal(displayHandle("chris_southgate"), "chris_southgate");
    assert.equal(displayHandle("  "), "unknown");
    assert.equal(handleInitial("@chris"), "C");
    assert.equal(handleInitial(""), "?");
  });

  it("requires both parent author and text", () => {
    assert.equal(hasParentContext({}), false);
    assert.equal(hasParentContext({ opAuthor: "@a" }), false);
    assert.equal(hasParentContext({ opText: "hello" }), false);
    assert.equal(hasParentContext({ opAuthor: "@a", opText: "hello" }), true);
  });

  it("labels quote vs reply", () => {
    assert.equal(parentKind({ isQuote: true }), "quote");
    assert.equal(parentKind({ isReply: true }), "reply");
    assert.equal(parentKind({ inReplyToId: "1" }), "reply");
    assert.equal(parentKind({}), "reply");
  });
});
