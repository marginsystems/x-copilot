import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { markDismissed } from "./dismissalStore.ts";
import {
  EXPIRED_MS,
  getExpiredThreadIds,
  listExpiredHistory,
  markExpired,
  selectStaleThreads,
} from "./expiredStore.ts";
import { runExpirePass, runExpirePassForAllUsers } from "./expirePass.ts";
import { markInteracted } from "./interactionStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import { getLastScout, saveScoutCache } from "./scoutCache.ts";
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
  let temp: TempPlatformDb;
  const userA = "user-a";
  const userB = "user-b";
  const now = Date.parse("2026-07-29T12:00:00.000Z");

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-expire-");
    seedUser(userA);
    seedUser(userB);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  async function fillTank(userId: string, suffix = ""): Promise<void> {
    await saveScoutCache(
      {
        savedAt: new Date(now).toISOString(),
        queries: ["q"],
        threads: [
          card({
            id: `old${suffix}`,
            author: "@old",
            createdAt: new Date(now - EXPIRED_MS - 5000).toISOString(),
            summary: "stale lead",
          }),
          card({
            id: `fresh${suffix}`,
            author: "@fresh",
            createdAt: new Date(now - 3600_000).toISOString(),
          }),
        ],
      },
      { userId },
    );
  }

  it("marks stale threads and prunes the user's tank", async () => {
    await fillTank(userA);

    const result = await runExpirePass({ userId: userA, nowMs: now });
    assert.equal(result.expired, 1);
    assert.deepEqual(result.ids, ["old"]);

    const history = await listExpiredHistory({ userId: userA });
    assert.equal(history[0]?.threadId, "old");
    assert.equal(history[0]?.summary, "stale lead");

    const tank = await getLastScout({ userId: userA });
    assert.deepEqual(tank?.threads.map((t) => t.id), ["fresh"]);

    const again = await runExpirePass({ userId: userA, nowMs: now });
    assert.equal(again.expired, 0);
  });

  it("skips threads the user already marked or dismissed", async () => {
    await saveScoutCache(
      {
        savedAt: new Date(now).toISOString(),
        queries: ["q"],
        threads: [
          card({
            id: "marked",
            author: "@m",
            createdAt: new Date(now - EXPIRED_MS - 5000).toISOString(),
          }),
          card({
            id: "dismissed",
            author: "@d",
            createdAt: new Date(now - EXPIRED_MS - 5000).toISOString(),
          }),
          card({
            id: "stale",
            author: "@s",
            createdAt: new Date(now - EXPIRED_MS - 5000).toISOString(),
          }),
        ],
      },
      { userId: userA },
    );
    await markInteracted({
      threadId: "marked",
      author: "@m",
      userId: userA,
      nowMs: now - 1000,
    });
    await markDismissed({ threadId: "dismissed", author: "@d", userId: userA });

    const result = await runExpirePass({ userId: userA, nowMs: now });
    assert.deepEqual(result.ids, ["stale"]);
  });

  it("expiring A does not write expired rows for B or prune B's tank", async () => {
    await fillTank(userA);
    await fillTank(userB, "-b");

    const result = await runExpirePass({ userId: userA, nowMs: now });
    assert.deepEqual(result.ids, ["old"]);

    assert.deepEqual(await listExpiredHistory({ userId: userB }), []);
    assert.equal((await getExpiredThreadIds({ userId: userB })).size, 0);
    const tankB = await getLastScout({ userId: userB });
    assert.deepEqual(
      tankB?.threads.map((t) => t.id),
      ["old-b", "fresh-b"],
    );
  });

  it("runExpirePassForAllUsers sweeps every tank into its own history", async () => {
    await fillTank(userA);
    await fillTank(userB, "-b");

    const result = await runExpirePassForAllUsers({ nowMs: now });
    assert.equal(result.users, 2);
    assert.equal(result.expired, 2);
    assert.deepEqual(
      (await listExpiredHistory({ userId: userA })).map((e) => e.threadId),
      ["old"],
    );
    assert.deepEqual(
      (await listExpiredHistory({ userId: userB })).map((e) => e.threadId),
      ["old-b"],
    );
  });

  it("markExpired upserts by user and threadId", async () => {
    const row = await markExpired({
      threadId: "1",
      author: "@x",
      userId: userA,
      nowMs: Date.parse("2026-07-29T10:00:00.000Z"),
    });
    assert.equal(row.threadId, "1");
    await markExpired({
      threadId: "1",
      author: "@x",
      userId: userA,
      nowMs: Date.parse("2026-07-29T11:00:00.000Z"),
    });
    const history = await listExpiredHistory({ userId: userA });
    assert.equal(history.length, 1);
    assert.deepEqual(await listExpiredHistory({ userId: userB }), []);
  });

  it("requires a userId", async () => {
    await assert.rejects(
      () => markExpired({ threadId: "1", author: "@x", userId: "" }),
      /userId is required/,
    );
  });
});
