import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCooledAuthorKeys,
  getAuthorKeysForScoutFilter,
  getEverInteractedAuthorKeys,
  listInteractionHistory,
  MAX_INTERACTION_HISTORY,
  MAX_INTERACTION_STORE,
  markInteracted,
  type Interaction,
} from "./interactionStore.ts";
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
import type { ThreadCard } from "./threadCard.ts";

function thread(id: string, author: string): ThreadCard {
  return {
    id,
    author,
    text: `post ${id}`,
    url: `https://x.com/${author.replace(/^@/, "")}/status/${id}`,
  };
}

describe("normalizeAuthorKey", () => {
  it("strips @, trims, lowercases", () => {
    assert.equal(normalizeAuthorKey("@Foo"), "foo");
    assert.equal(normalizeAuthorKey("  Foo  "), "foo");
    assert.equal(normalizeAuthorKey("@@Bar"), "bar");
  });
});

describe("parseStatusIdFromUrl", () => {
  it("parses x.com and twitter.com status URLs", () => {
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

  it("rejects non-status URLs", () => {
    assert.equal(parseStatusIdFromUrl("https://x.com/home"), null);
    assert.equal(parseStatusIdFromUrl("not a url"), null);
    assert.equal(parseStatusIdFromUrl(""), null);
  });
});

describe("isWithinCooldown", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");

  it("is true just after interaction", () => {
    assert.equal(isWithinCooldown(new Date(now - 1000).toISOString(), now), true);
  });

  it("is true just under 24h", () => {
    assert.equal(
      isWithinCooldown(new Date(now - COOLDOWN_MS + 1).toISOString(), now),
      true,
    );
  });

  it("is false at and after 24h", () => {
    assert.equal(
      isWithinCooldown(new Date(now - COOLDOWN_MS).toISOString(), now),
      false,
    );
    assert.equal(
      isWithinCooldown(new Date(now - COOLDOWN_MS - 1).toISOString(), now),
      false,
    );
  });

  it("rejects invalid dates", () => {
    assert.equal(isWithinCooldown("not-a-date", now), false);
  });
});

describe("pruneExpired", () => {
  const now = Date.parse("2026-07-26T12:00:00.000Z");

  it("drops expired and keeps active", () => {
    const items: Interaction[] = [
      {
        threadId: "1",
        author: "@a",
        authorKey: "a",
        at: new Date(now - 1000).toISOString(),
        source: "manual",
      },
      {
        threadId: "2",
        author: "@b",
        authorKey: "b",
        at: new Date(now - COOLDOWN_MS - 1).toISOString(),
        source: "copy",
      },
    ];
    const kept = pruneExpired(items, now);
    assert.deepEqual(
      kept.map((i) => i.threadId),
      ["1"],
    );
  });
});

describe("filterThreadsByCooldown", () => {
  it("removes matching authors and reports counts", () => {
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

  it("returns threads unchanged when no cooled keys", () => {
    const threads = [thread("1", "@a")];
    const result = filterThreadsByCooldown(threads, new Set());
    assert.equal(result.filteredCount, 0);
    assert.deepEqual(result.threads, threads);
  });

  it("drops sibling replies in an interacted conversation", () => {
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

describe("markInteracted", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-interact-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("upserts by threadId and refreshes at/source", async () => {
    const t1 = Date.parse("2026-07-26T10:00:00.000Z");
    const t2 = Date.parse("2026-07-26T11:00:00.000Z");
    await markInteracted({
      threadId: "99",
      author: "@Builder",
      source: "manual",
      nowMs: t1,
      storePath,
    });
    const second = await markInteracted({
      threadId: "99",
      author: "@Builder",
      source: "copy",
      nowMs: t2,
      storePath,
    });
    assert.equal(second.source, "copy");
    assert.equal(second.at, new Date(t2).toISOString());
    assert.equal(second.authorKey, "builder");

    const keys = await getCooledAuthorKeys({ nowMs: t2, storePath });
    assert.deepEqual([...keys], ["builder"]);
  });

  it("persists replyId / replyUrl / postedAt", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const row = await markInteracted({
      threadId: "parent1",
      author: "@target",
      replyId: "999",
      replyUrl: "https://x.com/me/status/999",
      nowMs: now,
      storePath,
    });
    assert.equal(row.replyId, "999");
    assert.equal(row.replyUrl, "https://x.com/me/status/999");
    assert.equal(row.postedAt, new Date(now).toISOString());
    const history = await listInteractionHistory({ storePath });
    assert.equal(history[0]?.replyId, "999");
  });

  it("persists discovered source", async () => {
    const row = await markInteracted({
      threadId: "parent2",
      author: "@target",
      source: "discovered",
      replyId: "888",
      replyUrl: "https://x.com/me/status/888",
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      storePath,
    });
    assert.equal(row.source, "discovered");
    const history = await listInteractionHistory({ storePath });
    assert.equal(history[0]?.source, "discovered");
  });

  it("persists conversationId for ancestry dedupe", async () => {
    const now = Date.parse("2026-08-05T21:25:22.077Z");
    const row = await markInteracted({
      threadId: "2085111070436602119",
      author: "@HypedTaktix",
      replyId: "2085114485963137476",
      replyUrl: "https://x.com/me/status/2085114485963137476",
      conversationId: "2084956842325635442",
      inReplyToId: "2084956842325635442",
      nowMs: now,
      storePath,
    });
    assert.equal(row.conversationId, "2084956842325635442");
    assert.equal(row.inReplyToId, "2084956842325635442");
  });

  it("keeps expired rows in history but not in cooldown keys", async () => {
    const now = Date.parse("2026-07-26T12:00:00.000Z");
    await markInteracted({
      threadId: "old",
      author: "@old",
      url: "https://x.com/old/status/old",
      summary: "old lead",
      nowMs: now - COOLDOWN_MS - 1000,
      storePath,
    });
    await markInteracted({
      threadId: "new",
      author: "@new",
      nowMs: now,
      storePath,
    });
    const keys = await getCooledAuthorKeys({ nowMs: now, storePath });
    assert.deepEqual([...keys], ["new"]);
    const history = await listInteractionHistory({ storePath });
    assert.deepEqual(
      history.map((i) => i.threadId),
      ["new", "old"],
    );
    assert.equal(history[1]?.url, "https://x.com/old/status/old");
    assert.equal(history[1]?.summary, "old lead");
  });

  it("retains beyond the feed cap for activity windows", async () => {
    const base = Date.parse("2026-07-26T12:00:00.000Z");
    const n = MAX_INTERACTION_HISTORY + 50;
    for (let i = 0; i < n; i++) {
      await markInteracted({
        threadId: `t${i}`,
        author: `@u${i}`,
        nowMs: base + i * 1000,
        storePath,
      });
    }
    const feed = await listInteractionHistory({ storePath });
    assert.equal(feed.length, MAX_INTERACTION_HISTORY);
    const retained = await listInteractionHistory({
      storePath,
      limit: MAX_INTERACTION_STORE,
    });
    assert.equal(retained.length, n);
  });
});

describe("listInteractionHistory", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-hist-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns newest first", async () => {
    const t1 = Date.parse("2026-07-26T10:00:00.000Z");
    const t2 = Date.parse("2026-07-26T11:00:00.000Z");
    await markInteracted({
      threadId: "a",
      author: "@a",
      nowMs: t1,
      storePath,
    });
    await markInteracted({
      threadId: "b",
      author: "@b",
      nowMs: t2,
      storePath,
    });
    const history = await listInteractionHistory({ storePath });
    assert.deepEqual(
      history.map((i) => i.threadId),
      ["b", "a"],
    );
  });
});

describe("memory sync retry flag", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-retry-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists the flag and clears it on success", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now,
      storePath,
    });

    await setMemorySyncFailed({ threadId: "parent", failed: true, storePath });
    const flagged = await listMemorySyncRetries({ storePath });
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.threadId, "parent");

    await setMemorySyncFailed({ threadId: "parent", failed: false, storePath });
    assert.equal((await listMemorySyncRetries({ storePath })).length, 0);
  });
});

describe("gamification sync retry flag", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-gamification-retry-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists mark/t24h flags and clears them on success", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "parent",
      author: "@target",
      replyId: "reply1",
      replyUrl: "https://x.com/me/status/reply1",
      nowMs: now,
      storePath,
    });

    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "mark",
      failed: true,
      storePath,
    });
    let flagged = await listGamificationSyncRetries({ storePath });
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.markGamificationSyncFailed, true);

    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "t24h",
      failed: true,
      storePath,
    });
    flagged = await listGamificationSyncRetries({ storePath });
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.bonusGamificationSyncFailed, true);

    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "mark",
      failed: false,
      storePath,
    });
    flagged = await listGamificationSyncRetries({ storePath });
    assert.equal(flagged[0]?.markGamificationSyncFailed, undefined);
    assert.equal(flagged[0]?.bonusGamificationSyncFailed, true);

    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "t24h",
      failed: false,
      storePath,
    });
    assert.equal((await listGamificationSyncRetries({ storePath })).length, 0);
  });

  it("keeps pending ats appended by a concurrent soft-fail when clearing the mark flag", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const d1 = new Date(now).toISOString();
    const d2 = new Date(now + 1000).toISOString();
    await markInteracted({
      threadId: "parent",
      author: "@target",
      nowMs: now,
      storePath,
    });
    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "mark",
      failed: true,
      pendingAt: d1,
      storePath,
    });
    // A concurrent re-mark soft-fail appends a second pending at.
    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "mark",
      failed: true,
      pendingAt: d2,
      storePath,
    });

    // Retry tick clears only the at it replayed; d2 must survive.
    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "mark",
      failed: false,
      clearedPendingAts: [d1],
      storePath,
    });
    let flagged = await listGamificationSyncRetries({ storePath });
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0]?.markGamificationSyncFailed, true);
    assert.deepEqual(flagged[0]?.pendingMarkAts, [d2]);

    // Once the remaining at is replayed, the flag clears entirely.
    await setGamificationSyncFailed({
      threadId: "parent",
      checkpoint: "mark",
      failed: false,
      clearedPendingAts: [d2],
      storePath,
    });
    assert.equal((await listGamificationSyncRetries({ storePath })).length, 0);
  });
});

describe("getAuthorKeysForScoutFilter", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-dedupe-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("lifetime dedupe scans beyond the 200-row feed cap", async () => {
    const base = Date.parse("2026-07-28T12:00:00.000Z");
    const n = MAX_INTERACTION_HISTORY + 25;
    for (let i = 0; i < n; i++) {
      await markInteracted({
        threadId: `t${i}`,
        author: `@Author${i}`,
        nowMs: base + i * 1000,
        storePath,
      });
    }
    const ever = await getEverInteractedAuthorKeys({ storePath });
    assert.equal(ever.size, n);
    assert.ok(ever.has("author0"));
    assert.ok(ever.has(`author${n - 1}`));
  });

  it("keeps lifetime authors when dedupe on after 24h", async () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    await markInteracted({
      threadId: "old",
      author: "@OldAcct",
      nowMs: now - COOLDOWN_MS - 1000,
      storePath,
    });
    const ever = await getEverInteractedAuthorKeys({ storePath });
    assert.ok(ever.has("oldacct"));
    const withDedupe = await getAuthorKeysForScoutFilter({
      dedupeAccounts: true,
      nowMs: now,
      storePath,
    });
    assert.ok(withDedupe.has("oldacct"));
    const without = await getAuthorKeysForScoutFilter({
      dedupeAccounts: false,
      nowMs: now,
      storePath,
    });
    assert.equal(without.has("oldacct"), false);
  });
});
