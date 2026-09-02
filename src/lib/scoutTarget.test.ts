import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { ThreadCard } from "../desk/types.ts";
import {
  isLeafReply,
  preferRootTargets,
  retargetLeafToRoot,
} from "./scoutTarget.ts";

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id" | "text">,
): ThreadCard {
  return {
    author: partial.author ?? "@op",
    url: partial.url ?? `https://x.com/op/status/${partial.id}`,
    ...partial,
  };
}

describe("isLeafReply", () => {
  it("treats replies and nested conversation ids as leaves", () => {
    assert.equal(isLeafReply(card({ id: "1", text: "op" })), false);
    assert.equal(isLeafReply(card({ id: "2", text: "r", isReply: true })), true);
    assert.equal(
      isLeafReply(card({ id: "3", text: "r", inReplyToId: "1" })),
      true,
    );
  });
});

describe("retargetLeafToRoot", () => {
  it("rewrites a leftover last-scout leaf onto the OP", () => {
    const next = retargetLeafToRoot(
      card({
        id: "2094972856287248809",
        author: "@Chris_Stephan",
        text: "leaf take",
        isReply: true,
        inReplyToId: "2094754837036707984",
        conversationId: "2094754837036707984",
        opAuthor: "@gmkurtzer",
        opText: "anti-AI FUD",
        views: 5,
        url: "https://x.com/Chris_Stephan/status/2094972856287248809",
      }),
    );
    assert.ok(next);
    assert.equal(next.id, "2094754837036707984");
    assert.equal(next.author, "@gmkurtzer");
    assert.equal(next.url, "https://x.com/gmkurtzer/status/2094754837036707984");
    assert.equal(next.isReply, false);
  });

  it("drops a leaf with no OP text", () => {
    assert.equal(
      retargetLeafToRoot(
        card({ id: "leaf", text: "yeah", isReply: true, inReplyToId: "1" }),
      ),
      null,
    );
  });
});

describe("preferRootTargets", () => {
  it("keeps roots and ranks by views", () => {
    const ranked = preferRootTargets([
      card({
        id: "leaf",
        text: "leaf",
        isReply: true,
        conversationId: "quiet",
        opAuthor: "@a",
        opText: "quiet root",
        opViews: 12,
      }),
      card({ id: "loud", text: "op", views: 655 }),
    ]);
    assert.deepEqual(
      ranked.map((t) => t.id),
      ["loud", "quiet"],
    );
  });
});
