import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keepCuratedByHistory, parseInteractedHistory } from "./useDeskHistory.ts";

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

  it("keeps the active locked card while history hydrates", () => {
    assert.equal(
      keepCuratedByHistory(
        { id: "locked" },
        (id) => id === "locked",
        new Set(["locked"]),
        "locked",
      ),
      true,
    );
  });

  it("does not let a preserved card bypass history blocking", () => {
    assert.equal(
      keepCuratedByHistory(
        { id: "other", conversationId: "locked" },
        () => false,
        new Set(["locked"]),
        "locked",
      ),
      false,
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

describe("parseInteractedHistory", () => {
  it("accepts a pre-receipt payload and only treats state saved as remembered", () => {
    const rows = parseInteractedHistory([
      { threadId: "old", author: "@a", at: "2026-09-18" },
      {
        threadId: "saved",
        author: "@a",
        at: "2026-09-19",
        memory: { state: "saved" },
      },
      {
        threadId: "failed",
        author: "@a",
        at: "2026-09-19",
        memory: { state: "unavailable" },
      },
      {
        threadId: "junk",
        author: "@a",
        at: "2026-09-19",
        memory: "saved",
      },
    ]);
    assert.equal(rows[0]?.memory, undefined);
    assert.deepEqual(rows[1]?.memory, { state: "saved" });
    assert.deepEqual(rows[2]?.memory, { state: "unavailable" });
    assert.equal(rows[3]?.memory, undefined);
  });

  it("does not invent a saved receipt for a stale or foreign-shaped row", () => {
    assert.deepEqual(parseInteractedHistory(undefined), []);
    assert.deepEqual(
      parseInteractedHistory([
        { threadId: "late", author: "@b", at: "2026-09-19", memory: { ok: true } },
      ])[0]?.memory,
      undefined,
    );
  });
});
