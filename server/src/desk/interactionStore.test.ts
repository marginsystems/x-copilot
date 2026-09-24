import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCooledAuthorKeys,
  getAuthorKeysForScoutFilter,
  getEverInteractedAuthorKeys,
  listActiveInteractions,
  listInteractionHistory,
  MAX_INTERACTION_HISTORY,
  paginateInteractions,
  MAX_INTERACTION_STORE,
  markInteracted,
  readInteractionRow,
  writeInteractionRow,
  type Interaction,
} from "./interactionStore.ts";
import { patchInteractionStats } from "./interactionStats.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import {
  listGamificationSyncRetries,
  listMemorySyncRetries,
  setGamificationSyncFailed,
  setMemorySyncFailed,
} from "./interactionSync.ts";
import {
  COOLDOWN_MS,
  conversationIdsFromHistory,
  filterThreadsByCooldown,
  isWithinCooldown,
  normalizeAuthorKey,
  parseStatusIdFromUrl,
  pruneExpired,
  threadMatchesConversationIds,
} from "./interactionCooldown.ts";
import type { ThreadCard } from "../scout/threadCard.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";

function thread(id: string, author: string): ThreadCard {
  return {
    id,
    author,
    text: `post ${id}`,
    url: `https://x.com/${author.replace(/^@/, "")}/status/${id}`,
  };
}

await describe("normalizeAuthorKey", async () => {
  await it("strips @, trims, lowercases", () => {
    assert.equal(normalizeAuthorKey("@Foo"), "foo");
    assert.equal(normalizeAuthorKey("  Foo  "), "foo");
    assert.equal(normalizeAuthorKey("@@Bar"), "bar");
  });
});

await describe("parseStatusIdFromUrl", async () => {
  await it("parses x.com and twitter.com status URLs", () => {
    assert.equal(
      parseStatusIdFromUrl("https://x.com/me/status/1234567890"),
      "1234567890",
    );
    assert.equal(
      parseStatusIdFromUrl("https://twitter.com/me/status/99?s=20"),
      "99",
    );
    assert.equal(
      parseStatusIdFromUrl("x.com/foo/statuses/42"),
      "42",
    );
  });

  await it("rejects non-status URLs", () => {
    assert.equal(parseStatusIdFromUrl("https://x.com/home"), null);
    assert.equal(parseStatusIdFromUrl("not a url"), null);
    assert.equal(parseStatusIdFromUrl(""), null);
  });
});

await describe("isWithinCooldown", async () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");

  await it("is true just after interaction", () => {
    assert.equal(isWithinCooldown(new Date(now - 1000).toISOString(), now), true);
  });

  await it("is true just under 24h", () => {
    assert.equal(
      isWithinCooldown(new Date(now - COOLDOWN_MS + 1).toISOString(), now),
      true,
    );
  });

  await it("is false at and after 24h", () => {
    assert.equal(
      isWithinCooldown(new Date(now - COOLDOWN_MS).toISOString(), now),
      false,
    );
    assert.equal(
      isWithinCooldown(new Date(now - COOLDOWN_MS - 1).toISOString(), now),
      false,
    );
  });

  await it("rejects invalid dates", () => {
    assert.equal(isWithinCooldown("not-a-date", now), false);
  });
});

await describe("pruneExpired", async () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");

  await it("drops expired and keeps active", () => {
    const items: Interaction[] = [
      {
        threadId: "1",
        author: "@a",
        authorKey: "a",
        at: new Date(now - 1000).toISOString(),
        source: "manual",
        userId: "u1",
      },
      {
        threadId: "2",
        author: "@b",
        authorKey: "b",
        at: new Date(now - COOLDOWN_MS - 1).toISOString(),
        source: "copy",
        userId: "u1",
      },
    ];
    const kept = pruneExpired(items, now);
    assert.deepEqual(
      kept.map((i) => i.threadId),
      ["1"],
    );
  });
});

await describe("filterThreadsByCooldown", async () => {
  await it("removes matching authors and reports counts", () => {
    const cooled = new Set(["alice", "bob"]);
    const result = filterThreadsByCooldown(
      [
        thread("1", "@Alice"),
        thread("2", "@carol"),
        thread("3", "bob"),
        thread("4", "@Carol"),
      ],
      cooled,
    );
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2", "4"],
    );
    assert.equal(result.filteredCount, 2);
    assert.deepEqual(new Set(result.filteredAuthors), new Set(["alice", "bob"]));
  });

  await it("returns threads unchanged when no cooled keys", () => {
    const threads = [thread("1", "@a")];
    const result = filterThreadsByCooldown(threads, new Set());
    assert.equal(result.filteredCount, 0);
    assert.deepEqual(result.threads, threads);
  });

  await it("drops sibling replies in an interacted conversation", () => {
    const root = "2084956842325635442";
    const hyped: ThreadCard = {
      ...thread("2085111070436602119", "@HypedTaktix"),
      conversationId: root,
      inReplyToId: root,
    };
    const sibling: ThreadCard = {
      ...thread("2085101212874289506", "@figmajeet"),
      conversationId: root,
      inReplyToId: root,
    };
    const other = thread("99", "@unrelated");
    const op: ThreadCard = {
      ...thread(root, "@codingwithroby"),
      conversationId: root,
    };
    const blocked = conversationIdsFromHistory([
      {
        threadId: hyped.id,
        author: hyped.author,
        authorKey: "hypedtaktix",
        at: "2026-08-05T21:25:22.077Z",
        source: "manual",
        userId: "u1",
        conversationId: root,
        inReplyToId: root,
      },
    ]);
    assert.ok(blocked.has(root));
    assert.ok(threadMatchesConversationIds(sibling, blocked));
    assert.ok(threadMatchesConversationIds(op, blocked));
    const result = filterThreadsByCooldown(
      [hyped, sibling, other, op],
      new Set(),
      blocked,
    );
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["99"],
    );
    assert.equal(result.filteredCount, 3);
  });
});

await describe("markInteracted", async () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-interact-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("upserts by user and threadId and refreshes at/source", async () => {
    const t1 = Date.parse("2026-07-26T10:00:00.000Z");
    const t2 = Date.parse("2026-07-26T11:00:00.000Z");
    await markInteracted({
      threadId: "99",
      author: "@Builder",
      source: "manual",
      userId,
      nowMs: t1,
    });
    const second = await markInteracted({
      threadId: "99",
      author: "@Builder",
      source: "copy",
      userId,
      nowMs: t2,
    });
    assert.equal(second.source, "copy");
    assert.equal(second.at, new Date(t2).toISOString());
    assert.equal(second.authorKey, "builder");
    assert.equal(second.userId, userId);

    const keys = await getCooledAuthorKeys({ nowMs: t2, userId });
    assert.deepEqual([...keys], ["builder"]);
    assert.equal((await listInteractionHistory({ userId })).length, 1);
  });

  await it("rejects a mark without a userId", async () => {
    await assert.rejects(
      () =>
        markInteracted({
          threadId: "99",
          author: "@Builder",
          userId: "",
        }),
      /userId is required/,
    );
    await assert.rejects(
      () => listInteractionHistory({ userId: "  " }),
      /userId is required/,
    );
  });

  await it("rejects a mark for a user the platform does not know", async () => {
    await assert.rejects(
      () =>
        markInteracted({
          threadId: "99",
          author: "@Builder",
          userId: "ghost",
        }),
      /user_missing/,
    );
  });

  await it("keeps the same thread marked by different users", async () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    await markInteracted({
      threadId: "shared-thread",
      author: "@a",
      userId: "user-a",
      nowMs: now,
    });
    await markInteracted({
      threadId: "shared-thread",
      author: "@a",
      userId: "user-b",
      nowMs: now + 1000,
    });

    const userA = await listInteractionHistory({ userId: "user-a" });
    const userB = await listInteractionHistory({ userId: "user-b" });
    assert.deepEqual(userA.map((row) => row.userId), ["user-a"]);
    assert.deepEqual(userB.map((row) => row.userId), ["user-b"]);
    assert.equal(userA[0]?.at, new Date(now).toISOString());
    assert.equal(userB[0]?.at, new Date(now + 1000).toISOString());
  });

  await it("persists replyId / replyUrl / postedAt", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const row = await markInteracted({
      threadId: "parent1",
      author: "@target",
      userId,
      replyId: "999",
      replyUrl: "https://x.com/me/status/999",
      nowMs: now,
    });
    assert.equal(row.replyId, "999");
    assert.equal(row.replyUrl, "https://x.com/me/status/999");
    assert.equal(row.postedAt, new Date(now).toISOString());
    const history = await listInteractionHistory({ userId });
    assert.equal(history[0]?.replyId, "999");
    assert.equal(history[0]?.postedAt, new Date(now).toISOString());
  });

  await it("persists discovered source", async () => {
    const row = await markInteracted({
      threadId: "parent2",
      author: "@target",
      source: "discovered",
      userId,
      replyId: "888",
      replyUrl: "https://x.com/me/status/888",
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
    });
    assert.equal(row.source, "discovered");
    const history = await listInteractionHistory({ userId });
    assert.equal(history[0]?.source, "discovered");
  });

  await it("persists conversationId for ancestry dedupe", async () => {
    const now = Date.parse("2026-08-05T21:25:22.077Z");
    const row = await markInteracted({
      threadId: "2085111070436602119",
      author: "@HypedTaktix",
      userId,
      replyId: "2085114485963137476",
      replyUrl: "https://x.com/me/status/2085114485963137476",
      conversationId: "2084956842325635442",
      inReplyToId: "2084956842325635442",
      nowMs: now,
    });
    assert.equal(row.conversationId, "2084956842325635442");
    assert.equal(row.inReplyToId, "2084956842325635442");
    const [stored] = await listInteractionHistory({ userId });
    assert.equal(stored?.conversationId, "2084956842325635442");
    assert.equal(stored?.inReplyToId, "2084956842325635442");
  });

  await it("keeps expired rows in history but not in cooldown keys", async () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    await markInteracted({
      threadId: "old",
      author: "@old",
      userId,
      url: "https://x.com/old/status/old",
      summary: "old lead",
      nowMs: now - COOLDOWN_MS - 1000,
    });
    await markInteracted({
      threadId: "new",
      author: "@new",
      userId,
      nowMs: now,
    });
    const keys = await getCooledAuthorKeys({ nowMs: now, userId });
    assert.deepEqual([...keys], ["new"]);
    const history = await listInteractionHistory({ userId });
    assert.deepEqual(
      history.map((i) => i.threadId),
      ["new", "old"],
    );
    assert.equal(history[1]?.url, "https://x.com/old/status/old");
    assert.equal(history[1]?.summary, "old lead");
  });

  await it("retains beyond the feed cap for activity windows and trims per user", async () => {
    const base = Date.parse("2026-07-26T12:00:00.000Z");
    const n = MAX_INTERACTION_HISTORY + 50;
    for (let i = 0; i < n; i++) {
      await markInteracted({
        threadId: `t${i}`,
        author: `@u${i}`,
        userId,
        nowMs: base + i * 1000,
      });
    }
    await markInteracted({
      threadId: "b-only",
      author: "@b",
      userId: "user-b",
      nowMs: base,
    });
    const feed = await listInteractionHistory({ userId });
    assert.equal(feed.length, MAX_INTERACTION_HISTORY);
    const retained = await listInteractionHistory({
      userId,
      limit: MAX_INTERACTION_STORE,
    });
    assert.equal(retained.length, n);
    const first = paginateInteractions(retained, null);
    assert.equal(first.interactions.length, 10);
    assert.equal(first.total, n);
    assert.equal(first.page, 1);
    assert.equal(first.pageSize, 10);
    assert.equal(first.interactions[0]?.threadId, `t${n - 1}`);
    const last = paginateInteractions(retained, "25");
    assert.deepEqual(last.interactions.map((row) => row.threadId),
      Array.from({ length: 10 }, (_, i) => `t${9 - i}`));
    assert.equal(last.total, n);
    assert.equal(last.blockedIds.length, n);
    assert.deepEqual(paginateInteractions(retained, "26").interactions, []);
    assert.equal(
      (await listInteractionHistory({ userId: "user-b" })).length,
      1,
    );
  });

  await it("drops the oldest rows past the durable retain", async () => {
    const base = Date.parse("2026-07-26T12:00:00.000Z");
    const n = MAX_INTERACTION_STORE + 5;
    for (let i = 0; i < n; i++) {
      await markInteracted({
        threadId: `t${i}`,
        author: `@u${i}`,
        userId,
        nowMs: base + i * 1000,
      });
    }
    const retained = await listInteractionHistory({
      userId,
      limit: MAX_INTERACTION_STORE + 100,
    });
    assert.equal(retained.length, MAX_INTERACTION_STORE);
    assert.equal(paginateInteractions(retained, "200").interactions.length, 10);
    assert.equal(paginateInteractions(retained, "201").total, MAX_INTERACTION_STORE);
    assert.deepEqual(paginateInteractions(retained, "201").interactions, []);
    assert.equal(retained.at(-1)?.threadId, "t5");
  });
});

await describe("listInteractionHistory", async () => {
  let temp: TempPlatformDb;

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-hist-");
    seedUser("a");
    seedUser("b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("returns newest first", async () => {
    const t1 = Date.parse("2026-07-26T10:00:00.000Z");
    const t2 = Date.parse("2026-07-26T11:00:00.000Z");
    await markInteracted({
      threadId: "a",
      author: "@a",
      userId: "a",
      nowMs: t1,
    });
    await markInteracted({
      threadId: "b",
      author: "@b",
      userId: "a",
      nowMs: t2,
    });
    const history = await listInteractionHistory({ userId: "a" });
    assert.deepEqual(
      history.map((i) => i.threadId),
      ["b", "a"],
    );
  });

  await it("scopes history and active interactions to one user", async () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    await markInteracted({
      threadId: "thread-a",
      author: "@a",
      userId: "a",
      nowMs: now,
    });
    await markInteracted({
      threadId: "thread-b",
      author: "@b",
      userId: "b",
      nowMs: now,
    });

    const history = await listInteractionHistory({ userId: "a" });
    const active = await listActiveInteractions({
      userId: "a",
      nowMs: now,
    });
    assert.deepEqual(history.map((row) => row.threadId), ["thread-a"]);
    assert.deepEqual(active.map((row) => row.threadId), ["thread-a"]);
    const historyB = await listInteractionHistory({ userId: "b" });
    assert.deepEqual(historyB.map((row) => row.threadId), ["thread-b"]);
  });

  await it("does not leak cooldown or lifetime authors across users", async () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    await markInteracted({
      threadId: "thread-a",
      author: "@OnlyA",
      userId: "a",
      conversationId: "convo-a",
      nowMs: now,
    });
    assert.deepEqual(
      [...(await getCooledAuthorKeys({ userId: "b", nowMs: now }))],
      [],
    );
    assert.deepEqual([...(await getEverInteractedAuthorKeys({ userId: "b" }))], []);
    assert.deepEqual(
      [...(await getAuthorKeysForScoutFilter({ userId: "b", nowMs: now }))],
      [],
    );
    assert.ok(
      (await getAuthorKeysForScoutFilter({ userId: "a", nowMs: now })).has(
        "onlya",
      ),
    );
  });
});

await describe("memory sync retry flag", async () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-retry-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("persists the flag and clears it on success", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      userId,
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now,
    });

    await setMemorySyncFailed({ threadId: "parent", userId, failed: true });
    const flagged = await listMemorySyncRetries();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.threadId, "parent");
    assert.equal(flagged[0]?.userId, userId);

    // Another user's same threadId is untouched by the flag.
    await setMemorySyncFailed({
      threadId: "parent",
      userId: "user-b",
      failed: true,
    });
    assert.equal((await listMemorySyncRetries()).length, 1);

    await setMemorySyncFailed({ threadId: "parent", userId, failed: false });
    assert.equal((await listMemorySyncRetries()).length, 0);
  });
});

await describe("gamification sync retry flag", async () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-gamification-retry-");
    seedUser(userId);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("persists mark/t24h flags and clears them on success", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      userId,
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now,
    });

    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: true,
    });
    let flagged = await listGamificationSyncRetries();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.markGamificationSyncFailed, true);

    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "t24h",
      failed: true,
    });
    flagged = await listGamificationSyncRetries();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.bonusGamificationSyncFailed, true);

    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: false,
    });
    flagged = await listGamificationSyncRetries();
    assert.equal(flagged[0]?.markGamificationSyncFailed, undefined);
    assert.equal(flagged[0]?.bonusGamificationSyncFailed, true);

    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "t24h",
      failed: false,
    });
    assert.equal((await listGamificationSyncRetries()).length, 0);
  });

  await it("keeps pending ats appended by a concurrent soft-fail when clearing the mark flag", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const d1 = new Date(now).toISOString();
    const d2 = new Date(now + 1000).toISOString();
    await markInteracted({
      threadId: "parent",
      author: "@target",
      userId,
      nowMs: now,
    });
    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: true,
      pendingAt: d1,
    });
    // A concurrent re-mark soft-fail appends a second pending at.
    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: true,
      pendingAt: d2,
    });

    // Retry tick clears only the at it replayed; d2 must survive.
    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: false,
      clearedPendingAts: [d1],
    });
    let flagged = await listGamificationSyncRetries();
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.markGamificationSyncFailed, true);
    assert.deepEqual(flagged[0]?.pendingMarkAts, [d2]);

    // Once the remaining at is replayed, the flag clears entirely.
    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: false,
      clearedPendingAts: [d2],
    });
    assert.equal((await listGamificationSyncRetries()).length, 0);
  });

  await it("re-marking a thread preserves stats and pending flags", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      userId,
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now,
    });
    await patchInteractionStats({
      threadId: "parent",
      userId,
      checkpoint: "t1h",
      snapshot: { views: 12, sampledAt: new Date(now).toISOString() },
    });
    await setGamificationSyncFailed({
      threadId: "parent",
      userId,
      checkpoint: "mark",
      failed: true,
      pendingAt: new Date(now).toISOString(),
    });
    const remarked = await markInteracted({
      threadId: "parent",
      author: "@target",
      userId,
      nowMs: now + 5000,
    });
    assert.equal(remarked.stats?.t1h?.views, 12);
    assert.equal(remarked.markGamificationSyncFailed, true);
    assert.deepEqual(remarked.pendingMarkAts, [new Date(now).toISOString()]);
    const [stored] = await listInteractionHistory({ userId });
    assert.equal(stored?.stats?.t1h?.views, 12);
    assert.deepEqual(stored?.pendingMarkAts, [new Date(now).toISOString()]);
  });

  await it("does not persist the live stats overlay", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      userId,
      nowMs: now,
    });
    await patchInteractionStats({
      threadId: "parent",
      userId,
      checkpoint: "t1h",
      snapshot: { views: 12, sampledAt: new Date(now).toISOString() },
    });
    await patchInteractionStats({
      threadId: "parent",
      userId,
      checkpoint: "t24h",
      snapshot: { views: 24, sampledAt: new Date(now).toISOString() },
    });
    const stored = readInteractionRow(userId, "parent");
    assert.ok(stored);

    writeInteractionRow(
      {
        ...stored,
        stats: {
          ...stored.stats,
          live: { views: 99, sampledAt: new Date(now + 1000).toISOString() },
        },
      },
      ensureUserTenant(userId),
    );

    const reread = readInteractionRow(userId, "parent");
    assert.ok(reread);
    assert.equal(reread.stats?.live, undefined);
    assert.equal(reread.stats?.t1h?.views, 12);
    assert.equal(reread.stats?.t24h?.views, 24);
  });
});

await describe("getAuthorKeysForScoutFilter", async () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-dedupe-");
    seedUser(userId);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("lifetime dedupe scans beyond the 200-row feed cap", async () => {
    const base = Date.parse("2026-07-28T12:00:00.000Z");
    const n = MAX_INTERACTION_HISTORY + 25;
    for (let i = 0; i < n; i++) {
      await markInteracted({
        threadId: `t${i}`,
        author: `@Author${i}`,
        userId,
        nowMs: base + i * 1000,
      });
    }
    const ever = await getEverInteractedAuthorKeys({ userId });
    assert.equal(ever.size, n);
    assert.ok(ever.has("author0"));
    assert.ok(ever.has(`author${n - 1}`));
  });

  await it("keeps lifetime authors when dedupe on after 24h", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "old",
      author: "@OldAcct",
      userId,
      nowMs: now - COOLDOWN_MS - 1000,
    });
    const ever = await getEverInteractedAuthorKeys({ userId });
    assert.ok(ever.has("oldacct"));
    const withDedupe = await getAuthorKeysForScoutFilter({
      dedupeAccounts: true,
      nowMs: now,
      userId,
    });
    assert.ok(withDedupe.has("oldacct"));
    const without = await getAuthorKeysForScoutFilter({
      dedupeAccounts: false,
      nowMs: now,
      userId,
    });
    assert.equal(without.has("oldacct"), false);
  });
});
