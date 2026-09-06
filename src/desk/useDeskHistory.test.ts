import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keepCuratedByHistory } from "./useDeskHistory.ts";

describe("keepCuratedByHistory", () => {
  it("hides consumed ids", () => {
    const hidden = new Set(["used"]);
    assert.equal(
      keepCuratedByHistory(
        { id: "used" },
        (id) => hidden.has(id),
        new Set(),
      ),
      false,
    );
    assert.equal(
      keepCuratedByHistory(
        { id: "fresh" },
        (id) => hidden.has(id),
        new Set(),
      ),
      true,
    );
  });

  it("hides blocked conversations and parents", () => {
    const blocked = new Set(["root", "parent"]);
    assert.equal(
      keepCuratedByHistory(
        { id: "reply-1", conversationId: "root" },
        () => false,
        blocked,
      ),
      false,
    );
    assert.equal(
      keepCuratedByHistory(
        { id: "reply-2", inReplyToId: "parent" },
        () => false,
        blocked,
      ),
      false,
    );
  });

  it("does not inspect settings-shaped thread fields", () => {
    const parked = {
      id: "parked",
      views: 1,
      flags: ["political"],
      author: "@excluded",
    };
    assert.equal(
      keepCuratedByHistory(parked, () => false, new Set()),
      true,
    );
  });
});
