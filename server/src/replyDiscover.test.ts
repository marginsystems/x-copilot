import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listInteractionHistory,
  markInteracted,
} from "./interactionStore.ts";
import {
  buildOwnRepliesQuery,
  discoverOwnReplies,
  shouldImportDiscoveredReply,
} from "./replyDiscover.ts";
import type { ThreadCard } from "./xSearch.ts";
import { runStatsTick } from "./statsWorker.ts";

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "@me",
    text: "hello from off-app",
    url: `https://x.com/me/status/${partial.id}`,
    ...partial,
  };
}

describe("buildOwnRepliesQuery", () => {
  it("builds from: + filter:replies with within_time", () => {
    const q = buildOwnRepliesQuery("@MarginSystems", "24h");
    assert.match(q, /^from:MarginSystems filter:replies within_time:24h$/);
  });
});

describe("shouldImportDiscoveredReply", () => {
  const own = "me";
  const knownReplyIds = new Set<string>(["already"]);
  const knownThreadIds = new Set<string>(["parent-known"]);

  it("imports a fresh reply to someone else", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "r1",
          inReplyToId: "p1",
          inReplyToScreenName: "@other",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "import",
    );
  });

  it("skips missing parent fields", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({ id: "r1" }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "missing_parent",
    );
  });

  it("skips self-replies", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "r1",
          inReplyToId: "p1",
          inReplyToScreenName: "@Me",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "self_reply",
    );
  });

  it("skips known replyId / threadId", () => {
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "already",
          inReplyToId: "p2",
          inReplyToScreenName: "@other",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "known_reply",
    );
    assert.equal(
      shouldImportDiscoveredReply({
        card: card({
          id: "r2",
          inReplyToId: "parent-known",
          inReplyToScreenName: "@other",
        }),
        ownScreenName: own,
        knownReplyIds,
        knownThreadIds,
      }),
      "known_thread",
    );
  });
});

describe("discoverOwnReplies", () => {
  let dir: string;
  let storePath: string;
  let knowledgeRoot: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-discover-"));
    storePath = join(dir, "interactions.json");
    knowledgeRoot = join(dir, "knowledge");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("upserts new replies and writes knowledge; skips dupes/self", async () => {
    await markInteracted({
      threadId: "already-parent",
      author: "@prior",
      replyId: "already-reply",
      replyUrl: "https://x.com/me/status/already-reply",
      source: "manual",
      nowMs: Date.parse("2026-08-02T10:00:00.000Z"),
      storePath,
    });

    const now = Date.parse("2026-08-02T12:00:00.000Z");
    const result = await discoverOwnReplies({
      nowMs: now,
      storePath,
      knowledgeRoot,
      upsertMemory: false,
      session: {
        configured: true,
        bearerToken: "t",
        operatorUserId: "",
        operatorUsername: "me",
      },
      resolveScreenName: async () => "me",
      searchTimelinePages: async (opts) => {
        assert.match(opts.query, /from:me filter:replies/);
        assert.match(opts.query, /within_time:24h/);
        assert.equal(opts.product, "Latest");
        assert.equal(opts.maxPages, 1);
        return {
          ok: true,
          threads: [
            card({
              id: "new-reply",
              text: "off-app take",
              inReplyToId: "new-parent",
              inReplyToScreenName: "@builder",
              conversationId: "conv-1",
              createdAt: "2026-08-02T11:30:00.000Z",
              opText: "parent lead",
            }),
            card({
              id: "already-reply",
              inReplyToId: "already-parent",
              inReplyToScreenName: "@prior",
            }),
            card({
              id: "self-reply",
              inReplyToId: "my-own",
              inReplyToScreenName: "@me",
            }),
            card({
              id: "no-parent",
              text: "not a reply card",
            }),
          ],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.discovered, 1);
    assert.equal(result.skipped, 3);
    assert.equal(result.searched, 4);

    const history = await listInteractionHistory({ storePath });
    const row = history.find((h) => h.threadId === "new-parent");
    assert.ok(row);
    assert.equal(row.source, "discovered");
    assert.equal(row.author, "@builder");
    assert.equal(row.replyId, "new-reply");
    assert.equal(row.replyUrl, "https://x.com/me/status/new-reply");
    assert.equal(row.postedAt, "2026-08-02T11:30:00.000Z");
    assert.equal(row.conversationId, "conv-1");
    assert.equal(row.url, "https://x.com/builder/status/new-parent");

    const note = await readFile(
      join(knowledgeRoot, "interactions", "2026-08-02-new-parent.md"),
      "utf8",
    );
    assert.match(note, /source: discovered/);
    assert.match(note, /off-app take/);
  });

  it("normalizes X's real created_at format to ISO postedAt", async () => {
    const result = await discoverOwnReplies({
      nowMs: Date.parse("2026-08-02T12:00:00.000Z"),
      storePath,
      knowledgeRoot,
      upsertMemory: false,
      session: {
        configured: true,
        bearerToken: "t",
        operatorUserId: "",
        operatorUsername: "me",
      },
      resolveScreenName: async () => "me",
      searchTimelinePages: async () => ({
        ok: true,
        threads: [
          card({
            id: "r-legacy",
            text: "off-app",
            inReplyToId: "p-legacy",
            inReplyToScreenName: "@other",
            createdAt: "Sat Jul 25 00:00:00 +0000 2026",
          }),
        ],
        queryId: "q",
        bottomCursor: null,
        pages: 1,
      }),
    });

    assert.equal(result.discovered, 1);
    const history = await listInteractionHistory({ storePath });
    const row = history.find((h) => h.threadId === "p-legacy");
    assert.ok(row);
    assert.equal(row.postedAt, "2026-07-25T00:00:00.000Z");
  });

  it("is idempotent across ticks", async () => {
    const search = async () => ({
      ok: true as const,
      threads: [
        card({
          id: "r1",
          text: "once",
          inReplyToId: "p1",
          inReplyToScreenName: "@x",
        }),
      ],
      queryId: "q",
      bottomCursor: null,
      pages: 1,
    });
    const opts = {
      storePath,
      knowledgeRoot,
      upsertMemory: false as const,
      session: {
        configured: true,
        bearerToken: "t",
        operatorUserId: "",
        operatorUsername: "me",
      },
      resolveScreenName: async () => "me",
      searchTimelinePages: search,
    };
    const first = await discoverOwnReplies(opts);
    const second = await discoverOwnReplies(opts);
    assert.equal(first.discovered, 1);
    assert.equal(second.discovered, 0);
    assert.equal(second.skipped, 1);
    const history = await listInteractionHistory({ storePath });
    assert.equal(history.filter((h) => h.threadId === "p1").length, 1);
  });

  it("soft-fails when credentials missing", async () => {
    const result = await discoverOwnReplies({
      session: {
        configured: false,
        bearerToken: "",
        operatorUserId: "",
        operatorUsername: "",
      },
      storePath,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "missing_credentials");
    assert.equal(result.discovered, 0);
  });
});

describe("runStatsTick discovery wiring", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-discover-tick-"));
    storePath = join(dir, "interactions.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("runs discovery before metrics and reports counts", async () => {
    let discoverCalls = 0;
    const result = await runStatsTick({
      storePath,
      delayMs: 0,
      syncOutcome: null,
      fetchMetrics: async () => null,
      discoverReplies: async () => {
        discoverCalls += 1;
        await markInteracted({
          threadId: "p-discovered",
          author: "@target",
          source: "discovered",
          replyId: "r-discovered",
          replyUrl: "https://x.com/me/status/r-discovered",
          nowMs: Date.parse("2026-08-02T10:00:00.000Z"),
          storePath,
        });
        return {
          ok: true,
          searched: 1,
          discovered: 1,
          skipped: 0,
        };
      },
    });
    assert.equal(discoverCalls, 1);
    assert.equal(result.discovered, 1);
    const history = await listInteractionHistory({ storePath });
    assert.equal(history[0]?.source, "discovered");
  });
});
