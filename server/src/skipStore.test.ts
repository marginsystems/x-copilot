import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSkippedThreadIds,
  listSkipHistory,
  markSkipped,
} from "./skipStore.ts";

describe("markSkipped / listSkipHistory", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-skip-"));
    storePath = join(dir, "skipped.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("upserts by threadId and lists newest first", async () => {
    const t1 = Date.parse("2026-07-28T10:00:00.000Z");
    const t2 = Date.parse("2026-07-28T11:00:00.000Z");
    await markSkipped({
      threadId: "a",
      author: "@a",
      text: "first pass",
      nowMs: t1,
      storePath,
    });
    await markSkipped({
      threadId: "b",
      author: "@b",
      nowMs: t2,
      storePath,
    });
    await markSkipped({
      threadId: "a",
      author: "@a",
      text: "updated",
      nowMs: t2 + 1000,
      storePath,
    });
    const history = await listSkipHistory({ storePath });
    assert.deepEqual(
      history.map((d) => d.threadId),
      ["a", "b"],
    );
    assert.equal(history[0]?.text, "updated");
    const ids = await getSkippedThreadIds({ storePath });
    assert.equal(ids.has("a"), true);
    assert.equal(ids.has("b"), true);
    assert.equal(ids.has("c"), false);
  });

  it("does not store a reason field", async () => {
    const row = await markSkipped({
      threadId: "x",
      author: "@x",
      storePath,
    });
    assert.equal("reason" in row, false);
  });
});
