import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EXPIRED_MS,
  listExpiredHistory,
  markExpired,
  selectStaleThreads,
} from "./expiredStore.ts";
import { runExpirePass } from "./expirePass.ts";
import {
  clearScoutCacheMemory,
  saveScoutCache,
} from "./scoutCache.ts";
import type { ThreadCard } from "./threadCard.ts";

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "@a",
    text: "hello",
    url: `https://x.com/a/status/${partial.id}`,
    ...partial,
  };
}

describe("selectStaleThreads", () => {
  const now = Date.parse("2026-07-29T12:00:00.000Z");

  it("includes threads older than 24h", () => {
    const stale = selectStaleThreads(
      [
        card({
          id: "old",
          createdAt: new Date(now - EXPIRED_MS - 1000).toISOString(),
        }),
        card({
          id: "fresh",
          createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
        }),
      ],
      now,
    );
    assert.deepEqual(
      stale.map((t) => t.id),
      ["old"],
    );
  });

  it("skips missing/bad createdAt and skipIds", () => {
    const stale = selectStaleThreads(
      [
        card({ id: "nope" }),
        card({ id: "bad", createdAt: "not-a-date" }),
        card({
          id: "skipme",
          createdAt: new Date(now - EXPIRED_MS - 1).toISOString(),
        }),
      ],
      now,
      new Set(["skipme"]),
    );
    assert.equal(stale.length, 0);
  });
});

describe("runExpirePass", () => {
  let dir: string;
  let scoutPath: string;
  let expiredPath: string;
  let interactionPath: string;
  let dismissalPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-expire-"));
    scoutPath = join(dir, "last-scout.json");
    expiredPath = join(dir, "expired.json");
    interactionPath = join(dir, "interactions.json");
    dismissalPath = join(dir, "dismissals.json");
    clearScoutCacheMemory();
  });

  afterEach(async () => {
    clearScoutCacheMemory();
    await rm(dir, { recursive: true, force: true });
  });

  it("marks stale threads and prunes last-scout", async () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");
    await saveScoutCache(
      {
        savedAt: new Date(now).toISOString(),
        queries: ["q"],
        threads: [
          card({
            id: "old",
            author: "@old",
            createdAt: new Date(now - EXPIRED_MS - 5000).toISOString(),
            summary: "stale lead",
          }),
          card({
            id: "fresh",
            author: "@fresh",
            createdAt: new Date(now - 3600_000).toISOString(),
          }),
        ],
      },
      { storePath: scoutPath },
    );

    const result = await runExpirePass({
      nowMs: now,
      scoutStorePath: scoutPath,
      expiredStorePath: expiredPath,
      interactionStorePath: interactionPath,
      dismissalStorePath: dismissalPath,
    });
    assert.equal(result.expired, 1);
    assert.deepEqual(result.ids, ["old"]);

    const history = await listExpiredHistory({ storePath: expiredPath });
    assert.equal(history[0]?.threadId, "old");
    assert.equal(history[0]?.summary, "stale lead");

    // Re-load cache from disk path via another expire pass — fresh remains.
    clearScoutCacheMemory();
    const again = await runExpirePass({
      nowMs: now,
      scoutStorePath: scoutPath,
      expiredStorePath: expiredPath,
      interactionStorePath: interactionPath,
      dismissalStorePath: dismissalPath,
    });
    assert.equal(again.expired, 0);
  });

  it("markExpired upserts by threadId", async () => {
    const row = await markExpired({
      threadId: "1",
      author: "@x",
      storePath: expiredPath,
      nowMs: Date.parse("2026-07-29T10:00:00.000Z"),
    });
    assert.equal(row.threadId, "1");
    const history = await listExpiredHistory({ storePath: expiredPath });
    assert.equal(history.length, 1);
  });
});
