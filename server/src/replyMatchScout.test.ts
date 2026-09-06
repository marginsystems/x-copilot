import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { replyMatchesLockedScout } from "./replyMatchScout.ts";

describe("replyMatchesLockedScout", () => {
  const card = {
    id: "card-1",
    conversationId: "root-1",
    inReplyToId: "parent-1",
  };

  it("matches a reply directly to the card", () => {
    assert.equal(
      replyMatchesLockedScout(
        { inReplyToId: "card-1", conversationId: "root-1" },
        card,
      ),
      true,
    );
  });

  it("rejects an unrelated reply in the card conversation", () => {
    assert.equal(
      replyMatchesLockedScout(
        { inReplyToId: "other-child", conversationId: "root-1" },
        card,
      ),
      false,
    );
  });

  it("rejects a reply to the conversation root for a non-root card", () => {
    assert.equal(
      replyMatchesLockedScout(
        { inReplyToId: "root-1", conversationId: "root-1" },
        card,
      ),
      false,
    );
  });

  it("matches the card parent when conversation is unavailable", () => {
    assert.equal(
      replyMatchesLockedScout(
        { inReplyToId: "parent-1", conversationId: null },
        card,
      ),
      true,
    );
  });

  it("rejects a foreign conversation despite a parent id match", () => {
    assert.equal(
      replyMatchesLockedScout(
        { inReplyToId: "card-1", conversationId: "foreign-root" },
        card,
      ),
      false,
    );
  });
});
