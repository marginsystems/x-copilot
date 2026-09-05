import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { vanishEvent } from "./vanishEvent.ts";

const base = {
  cardId: "card",
  interactedIds: new Set<string>(),
  history: [],
};

describe("vanishEvent", () => {
  it("marks a directly interacted card", () => {
    assert.equal(
      vanishEvent({ ...base, interactedIds: new Set(["card"]) }),
      "mark",
    );
  });

  it("marks through conversation and parent ancestry", () => {
    assert.equal(
      vanishEvent({
        ...base,
        conversationId: "root",
        history: [{ threadId: "other", conversationId: "root" }],
      }),
      "mark",
    );
    assert.equal(
      vanishEvent({
        ...base,
        inReplyToId: "parent",
        history: [{ threadId: "parent" }],
      }),
      "mark",
    );
  });

  it("marks when a history row points back to the card", () => {
    assert.equal(
      vanishEvent({
        ...base,
        history: [{ threadId: "reply", inReplyToId: "card" }],
      }),
      "mark",
    );
  });

  it("skips an unrelated vanished card", () => {
    assert.equal(
      vanishEvent({
        ...base,
        conversationId: "root",
        history: [{ threadId: "other", conversationId: "other-root" }],
      }),
      "skip",
    );
  });
});
