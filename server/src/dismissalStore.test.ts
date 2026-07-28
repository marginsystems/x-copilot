import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listDismissalHistory,
  markDismissed,
} from "./dismissalStore.ts";

describe("markDismissed / listDismissalHistory", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-dismiss-"));
    storePath = join(dir, "dismissals.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists reason and lists newest first", async () => {
    const t1 = Date.parse("2026-07-28T10:00:00.000Z");
    const t2 = Date.parse("2026-07-28T11:00:00.000Z");
    await markDismissed({
      threadId: "a",
      author: "@a",
      reason: "off topic",
      nowMs: t1,
      storePath,
    });
    await markDismissed({
      threadId: "b",
      author: "@b",
      nowMs: t2,
      storePath,
    });
    const history = await listDismissalHistory({ storePath });
    assert.deepEqual(
      history.map((d) => d.threadId),
      ["b", "a"],
    );
    assert.equal(history[1]?.reason, "off topic");
  });
});
