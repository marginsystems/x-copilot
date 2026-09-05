import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import {
  MAX_SKIP_HISTORY,
  getSkippedThreadIds,
  listSkipHistory,
  markSkipped,
} from "./skipStore.ts";

describe("markSkipped / listSkipHistory", () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-skip-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  it("upserts by threadId and lists newest first", async () => {
    const t1 = Date.parse("2026-07-28T10:00:00.000Z");
    const t2 = Date.parse("2026-07-28T11:00:00.000Z");
    await markSkipped({
      threadId: "a",
      author: "@a",
      userId,
      text: "first pass",
      nowMs: t1,
    });
    await markSkipped({
      threadId: "b",
      author: "@b",
      userId,
      nowMs: t2,
    });
    await markSkipped({
      threadId: "a",
      author: "@a",
      userId,
      text: "updated",
      nowMs: t2 + 1000,
    });
    const history = await listSkipHistory({ userId });
    assert.deepEqual(
      history.map((d) => d.threadId),
      ["a", "b"],
    );
    assert.equal(history[0]?.text, "updated");
    const ids = await getSkippedThreadIds({ userId });
    assert.equal(ids.has("a"), true);
    assert.equal(ids.has("b"), true);
    assert.equal(ids.has("c"), false);
  });

  it("does not store a reason field", async () => {
    const row = await markSkipped({
      threadId: "x",
      author: "@x",
      userId,
    });
    assert.equal("reason" in row, false);
  });

  it("requires a userId", async () => {
    await assert.rejects(
      () => markSkipped({ threadId: "x", author: "@x", userId: "" }),
      /userId is required/,
    );
  });

  it("keeps one user's skips out of another's list", async () => {
    await markSkipped({ threadId: "shared", author: "@a", userId });
    const a = await listSkipHistory({ userId });
    const b = await listSkipHistory({ userId: "user-b" });
    assert.deepEqual(a.map((d) => d.threadId), ["shared"]);
    assert.deepEqual(b, []);
    assert.equal((await getSkippedThreadIds({ userId: "user-b" })).has("shared"), false);

    // B skipping the same thread does not touch A's row.
    await markSkipped({
      threadId: "shared",
      author: "@a",
      userId: "user-b",
      text: "b's note",
    });
    assert.equal((await listSkipHistory({ userId }))[0]?.text, undefined);
    assert.equal(
      (await listSkipHistory({ userId: "user-b" }))[0]?.text,
      "b's note",
    );
  });

  it("caps history per user", async () => {
    const base = Date.parse("2026-07-28T10:00:00.000Z");
    for (let i = 0; i < MAX_SKIP_HISTORY + 3; i++) {
      await markSkipped({
        threadId: `t${i}`,
        author: `@u${i}`,
        userId,
        nowMs: base + i * 1000,
      });
    }
    await markSkipped({ threadId: "b1", author: "@b", userId: "user-b" });
    const history = await listSkipHistory({ userId, limit: 1000 });
    assert.equal(history.length, MAX_SKIP_HISTORY);
    assert.equal(history.at(-1)?.threadId, "t3");
    assert.equal((await listSkipHistory({ userId: "user-b" })).length, 1);
  });
});
