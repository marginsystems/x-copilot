import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COOLDOWN_MS,
  filterThreadsByCooldown,
  getCooledAuthorKeys,
  isWithinCooldown,
  listInteractionHistory,
  markInteracted,
  normalizeAuthorKey,
  pruneExpired,
  type Interaction,
} from "./interactionStore.ts";
import type { ThreadCard } from "./xSearch.ts";

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
