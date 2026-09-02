import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  audienceViews,
  isLeafReply,
  preferRootTargets,
  retargetLeafToRoot,
  sortByAudience,
} from "./scoutTarget.ts";
import type { ThreadCard } from "./threadCard.ts";

function card(partial: Partial<ThreadCard> & Pick<ThreadCard, "id" | "text">): ThreadCard {
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
    assert.equal(
      isLeafReply(card({ id: "4", text: "r", conversationId: "1" })),
      true,
    );
  });
});

describe("retargetLeafToRoot", () => {
  it("rewrites the card onto the OP", () => {
    const next = retargetLeafToRoot(
      card({
        id: "leaf",
        author: "@leaf",
        text: "yeah keep 80%",
        isReply: true,
        inReplyToId: "mid",
        conversationId: "root",
        opAuthor: "@op",
        opText: "the real post",
        opViews: 655,
        views: 5,
        url: "https://x.com/leaf/status/leaf",
      }),
    );
    assert.ok(next);
    assert.equal(next.id, "root");
    assert.equal(next.author, "@op");
    assert.equal(next.text, "the real post");
    assert.equal(next.url, "https://x.com/op/status/root");
    assert.equal(next.isReply, false);
    assert.equal(next.inReplyToId, undefined);
    assert.equal(next.views, 655);
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
  it("keeps roots, retargets leaves, and ranks by views", () => {
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
      card({ id: "loud", text: "loud root", views: 400 }),
      card({ id: "mid", text: "mid root", views: 80 }),
    ]);
    assert.deepEqual(
      ranked.map((t) => t.id),
      ["loud", "mid", "quiet"],
    );
    assert.equal(ranked[0]?.views, 400);
  });
});

describe("sortByAudience", () => {
  it("puts missing views last", () => {
    const ranked = sortByAudience([
      { views: undefined },
      { views: 3 },
      { views: 90 },
    ]);
    assert.deepEqual(
      ranked.map((t) => audienceViews(t)),
      [90, 3, 0],
    );
  });
});
