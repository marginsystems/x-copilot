import { isRecord } from "../platform/unknownValue.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getPlatformDb } from "../db.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import {
  getLastScout,
  listScoutTankUserIds,
  mergeThreadsById,
  parseScoutSnapshot,
  pruneThreadsFromScoutCache,
  saveScoutCache,
  type LastScoutSnapshot,
} from "./scoutCache.ts";
import { markSkipped } from "../desk/skipStore.ts";

function sample(overrides: Partial<LastScoutSnapshot> = {}): LastScoutSnapshot {
  return {
    savedAt: "2026-07-27T02:00:00.000Z",
    agenda: "Find builders",
    queries: ["ship AI"],
    threads: [
      {
        id: "1",
        author: "@a",
        text: "hello",
        url: "https://x.com/a/status/1",
      },
    ],
    message: "Scout found 1 threads.",
    ...overrides,
  };
}

await describe("parseScoutSnapshot", async () => {
  await it("rejects invalid payloads", () => {
    assert.equal(parseScoutSnapshot(null), null);
    assert.equal(parseScoutSnapshot({ savedAt: "nope" }), null);
  });

  await it("keeps valid threads and drops junk rows", () => {
    const parsed = parseScoutSnapshot({
      savedAt: "2026-07-27T02:00:00.000Z",
      queries: ["q"],
      threads: [
        {
          id: "1",
          author: "@a",
          text: "t",
          url: "https://x.com/a/status/1",
        },
        { id: 2 },
      ],
    });
    assert.ok(parsed);
    assert.equal(parsed.threads.length, 1);
    assert.deepEqual(parsed.queries, ["q"]);
  });
});

await describe("saveScoutCache / getLastScout", async () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-scout-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("round-trips through scout_tanks with user and tenant", async () => {
    const snap = sample();
    const saved = {
      ...snap,
      threads: snap.threads.map((thread) => ({ ...thread, scoutAgendaSet: true })),
    };
    await saveScoutCache(snap, { userId });
    assert.deepEqual(await getLastScout({ userId }), saved);

    const row = parseRowRow(getPlatformDb()
      .prepare(
        `SELECT user_id, tenant_id, saved_at FROM scout_tanks WHERE user_id = ?`,
      )
      .get(userId));
    assert.equal(row.user_id, userId);
    assert.ok(row.tenant_id);
    assert.equal(row.saved_at, snap.savedAt);
    assert.deepEqual(listScoutTankUserIds(), [userId]);
  });

  await it("returns null for a user who never Scouted", async () => {
    assert.equal(await getLastScout({ userId }), null);
  });

  await it("requires a userId", async () => {
    await assert.rejects(
      () => saveScoutCache(sample(), { userId: "" }),
      /userId is required/,
    );
    await assert.rejects(() => getLastScout({ userId: "" }), /userId is required/);
  });

  await it("keeps each user's tank separate", async () => {
    await saveScoutCache(sample({ message: "a's run" }), { userId });
    await saveScoutCache(
      sample({
        message: "b's run",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { userId: "user-b" },
    );
    const a = await getLastScout({ userId });
    const b = await getLastScout({ userId: "user-b" });
    assert.equal(a?.message, "a's run");
    assert.deepEqual(a?.threads.map((t) => t.id), ["1"]);
    assert.equal(b?.message, "b's run");
    assert.deepEqual(b?.threads.map((t) => t.id), ["2"]);

    await pruneThreadsFromScoutCache(["1", "2"], { userId });
    assert.deepEqual((await getLastScout({ userId }))?.threads, []);
    assert.deepEqual(
      (await getLastScout({ userId: "user-b" }))?.threads.map((t) => t.id),
      ["2"],
    );
  });

  await it("replaces metadata but merges threads by id", async () => {
    await saveScoutCache(sample({ message: "first" }), { userId });
    await saveScoutCache(
      sample({
        message: "second",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { userId },
    );
    const last = await getLastScout({ userId });
    assert.equal(last?.message, "second");
    assert.deepEqual(
      last?.threads.map((t) => t.id),
      ["1", "2"],
    );
  });

  await it("keeps stored filters when a later snapshot omits them", async () => {
    const filters = {
      filterByMinViews: true,
      minViews: 250,
      excludedTags: [" Political ", "political"],
      excludedAccounts: ["@ChatGPT", "chatgpt"],
    };
    await saveScoutCache(sample({ filters }), { userId });
    await saveScoutCache(
      sample({
        filters: undefined,
        message: "collect refresh",
      }),
      { userId },
    );

    assert.deepEqual((await getLastScout({ userId }))?.filters, {
      filterByMinViews: true,
      minViews: 250,
      excludedTags: ["political"],
      excludedAccounts: ["chatgpt"],
    });
  });

  await it("does not revive consumed conversations during a later merge", async () => {
    await saveScoutCache(
      sample({
        threads: [
          {
            id: "reply-1",
            author: "@a",
            text: "first reply",
            url: "https://x.com/a/status/reply-1",
            conversationId: "root-1",
            inReplyToId: "parent-1",
          },
        ],
      }),
      { userId },
    );
    await markSkipped({
      threadId: "reply-1",
      author: "@a",
      userId,
      conversationId: "root-1",
      inReplyToId: "parent-1",
    });

    await saveScoutCache(
      sample({
        threads: [
          {
            id: "reply-2",
            author: "@b",
            text: "stale sibling",
            url: "https://x.com/b/status/reply-2",
            conversationId: "root-1",
          },
          {
            id: "2",
            author: "@c",
            text: "unrelated",
            url: "https://x.com/c/status/2",
            conversationId: "root-2",
          },
        ],
      }),
      { userId },
    );

    assert.deepEqual(
      (await getLastScout({ userId }))?.threads.map((thread) => thread.id),
      ["2"],
    );
  });

  await it("keeps agenda provenance when runs accumulate threads", async () => {
    await saveScoutCache(sample({ agenda: undefined }), { userId });
    const first = await getLastScout({ userId });
    assert.equal(
      first?.threads.find((t) => t.id === "1")?.scoutAgendaSet,
      false,
    );

    await saveScoutCache(
      sample({
        agenda: "Find builders",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { userId },
    );
    const last = await getLastScout({ userId });
    assert.equal(last?.threads.find((t) => t.id === "1")?.scoutAgendaSet, false);
    assert.equal(last?.threads.find((t) => t.id === "2")?.scoutAgendaSet, true);
  });

  await it("backfills agenda provenance from a tank saved without it", async () => {
    getPlatformDb()
      .prepare(
        `INSERT INTO scout_tanks (user_id, tenant_id, saved_at, snapshot_json)
         VALUES (?, 'local', ?, ?)`,
      )
      .run(
        userId,
        "2026-07-27T02:00:00.000Z",
        JSON.stringify({
          savedAt: "2026-07-27T02:00:00.000Z",
          agenda: "Legacy agenda",
          queries: ["old query"],
          threads: sample().threads,
        }),
      );

    await saveScoutCache(
      sample({
        agenda: "New agenda",
        threads: [
          {
            id: "2",
            author: "@b",
            text: "next",
            url: "https://x.com/b/status/2",
          },
        ],
      }),
      { userId },
    );

    const last = await getLastScout({ userId });
    assert.equal(last?.threads.find((t) => t.id === "1")?.scoutAgendaSet, false);
    assert.equal(last?.threads.find((t) => t.id === "2")?.scoutAgendaSet, true);
  });

  await it("refreshes agenda provenance for an existing thread", async () => {
    await saveScoutCache(sample({ agenda: "Agenda run" }), { userId });
    await saveScoutCache(sample({ agenda: undefined }), { userId });

    const last = await getLastScout({ userId });
    assert.equal(last?.threads.find((t) => t.id === "1")?.scoutAgendaSet, false);
  });
});

await describe("mergeThreadsById", async () => {
  await it("appends unseen ids and skips duplicates", () => {
    const a = {
      id: "1",
      author: "@a",
      text: "a",
      url: "https://x.com/a/status/1",
    };
    const b = {
      id: "2",
      author: "@b",
      text: "b",
      url: "https://x.com/b/status/2",
    };
    assert.deepEqual(
      mergeThreadsById([a], [a, b]).map((t) => t.id),
      ["1", "2"],
    );
  });
});

function parseRowRow(value: unknown): { user_id: string; tenant_id: string; saved_at: string } {
  const valid = (row: unknown): row is { user_id: string; tenant_id: string; saved_at: string } =>
    (isRecord(row) &&
    typeof row.user_id === "string" &&
    typeof row.tenant_id === "string" &&
    typeof row.saved_at === "string");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
