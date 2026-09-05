import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getPlatformDb } from "./db.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import {
  getLastScout,
  listScoutTankUserIds,
  mergeThreadsById,
  parseScoutSnapshot,
  pruneThreadsFromScoutCache,
  saveScoutCache,
  type LastScoutSnapshot,
} from "./scoutCache.ts";

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

describe("parseScoutSnapshot", () => {
  it("rejects invalid payloads", () => {
    assert.equal(parseScoutSnapshot(null), null);
    assert.equal(parseScoutSnapshot({ savedAt: "nope" }), null);
  });

  it("keeps valid threads and drops junk rows", () => {
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

describe("saveScoutCache / getLastScout", () => {
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

  it("round-trips through scout_tanks with user and tenant", async () => {
    const snap = sample();
    const saved = {
      ...snap,
      threads: snap.threads.map((thread) => ({ ...thread, scoutAgendaSet: true })),
    };
    await saveScoutCache(snap, { userId });
    assert.deepEqual(await getLastScout({ userId }), saved);

    const row = getPlatformDb()
      .prepare(
        `SELECT user_id, tenant_id, saved_at FROM scout_tanks WHERE user_id = ?`,
      )
      .get(userId) as { user_id: string; tenant_id: string; saved_at: string };
    assert.equal(row.user_id, userId);
    assert.ok(row.tenant_id);
    assert.equal(row.saved_at, snap.savedAt);
    assert.deepEqual(listScoutTankUserIds(), [userId]);
  });

  it("returns null for a user who never Scouted", async () => {
    assert.equal(await getLastScout({ userId }), null);
  });

  it("requires a userId", async () => {
    await assert.rejects(
      () => saveScoutCache(sample(), { userId: "" }),
      /userId is required/,
    );
    await assert.rejects(() => getLastScout({ userId: "" }), /userId is required/);
  });

  it("keeps each user's tank separate", async () => {
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

  it("replaces metadata but merges threads by id", async () => {
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

  it("keeps agenda provenance when runs accumulate threads", async () => {
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

  it("backfills agenda provenance from a tank saved without it", async () => {
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

  it("refreshes agenda provenance for an existing thread", async () => {
    await saveScoutCache(sample({ agenda: "Agenda run" }), { userId });
    await saveScoutCache(sample({ agenda: undefined }), { userId });

    const last = await getLastScout({ userId });
    assert.equal(last?.threads.find((t) => t.id === "1")?.scoutAgendaSet, false);
  });
});

describe("mergeThreadsById", () => {
  it("appends unseen ids and skips duplicates", () => {
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
