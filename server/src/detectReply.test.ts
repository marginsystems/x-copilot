import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  detectOwnReplyToThread,
  detectOwnReplyToThreadWithRetry,
  buildDetectOwnReplyQuery,
} from "./detectReply.ts";
import type { ThreadCard } from "./xSearch.ts";

function card(
  partial: Partial<ThreadCard> & Pick<ThreadCard, "id">,
): ThreadCard {
  return {
    author: "@me",
    text: "hello",
    url: `https://x.com/me/status/${partial.id}`,
    ...partial,
  };
}

describe("buildDetectOwnReplyQuery", () => {
  it("scopes to conversation + from + is:reply", () => {
    const q = buildDetectOwnReplyQuery("@alice", "parent1");
    assert.match(q, /conversation_id:parent1/);
    assert.match(q, /from:alice/);
    assert.match(q, /is:reply/);
    assert.match(q, /within_time:24h/);
  });

  it("prefers the conversation root id over the card id", () => {
    const q = buildDetectOwnReplyQuery(
      "@alice",
      "card1",
      "24h",
      "root1",
    );
    assert.match(q, /conversation_id:root1/);
    assert.doesNotMatch(q, /conversation_id:card1/);
  });
});

describe("detectOwnReplyToThread", () => {
  it("returns the unique reply matching inReplyToId", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "@alice",
      searchTimelinePages: async (opts) => {
        assert.match(opts.query, /conversation_id:parent1/);
        assert.match(opts.query, /from:alice/);
        assert.match(opts.query, /is:reply/);
        assert.match(opts.query, /within_time:24h/);
        assert.equal(opts.product, "Latest");
        assert.equal(opts.maxPages, 1);
        return {
          ok: true,
          threads: [
            card({ id: "other", inReplyToId: "zzz", text: "nope" }),
            card({
              id: "reply1",
              inReplyToId: "parent1",
              text: "happy to connect",
              createdAt: "2026-07-30T00:00:00.000Z",
            }),
          ],
          queryId: "q",
          bottomCursor: null,
          pages: 1,
        };
      },
    });
    assert.equal(result.ok, true);
    assert.ok(result.reply);
    assert.equal(result.reply.replyId, "reply1");
    assert.equal(result.reply.replyText, "happy to connect");
    assert.equal(result.reply.replyUrl, "https://x.com/me/status/reply1");
    assert.equal(result.rawCount, 2);
    assert.equal(result.matchCount, 1);
  });

  it("returns none when no parent match", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "me",
      searchTimelinePages: async () => ({
        ok: true,
        threads: [card({ id: "a", inReplyToId: "other" })],
        queryId: "q",
        bottomCursor: null,
      }),
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "none",
      rawCount: 1,
      matchCount: 0,
    });
  });

  it("returns ambiguous when multiple parent matches", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "me",
      searchTimelinePages: async () => ({
        ok: true,
        threads: [
          card({ id: "a", inReplyToId: "parent1" }),
          card({ id: "b", inReplyToId: "parent1" }),
        ],
        queryId: "q",
        bottomCursor: null,
      }),
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "ambiguous",
      rawCount: 2,
      matchCount: 2,
    });
  });

  it("returns search_failed on search error", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "me",
      searchTimelinePages: async () => ({
        ok: false,
        status: 429,
        error: "rate_limited",
        message: "busy",
      }),
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "search_failed",
      rawCount: 0,
      matchCount: 0,
    });
  });

  it("returns search_failed for empty screen name", async () => {
    const result = await detectOwnReplyToThread({
      threadId: "parent1",
      screenName: "",
      searchTimelinePages: async () => {
        throw new Error("should not search");
      },
    });
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "search_failed",
      rawCount: 0,
      matchCount: 0,
    });
  });
});

describe("detectOwnReplyToThreadWithRetry", () => {
  it("retries none then returns found on second attempt", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const logs: string[] = [];
    const result = await detectOwnReplyToThreadWithRetry({
      threadId: "parent1",
      screenName: "me",
      delaysMs: [0, 2000, 5000],
      sleep: async (ms) => {
        sleeps.push(ms);
        return "ok";
      },
      log: (line) => logs.push(line),
      searchTimelinePages: async () => {
        calls += 1;
        if (calls === 1) {
          return {
            ok: true,
            threads: [card({ id: "a", inReplyToId: "other" })],
            queryId: "q",
            bottomCursor: null,
          };
        }
        return {
          ok: true,
          threads: [
            card({
              id: "reply1",
              inReplyToId: "parent1",
              text: "found later",
            }),
          ],
          queryId: "q",
          bottomCursor: null,
        };
      },
    });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [2000]);
    assert.ok(result.reply);
    assert.equal(result.reply.replyId, "reply1");
    assert.equal(logs.length, 2);
    assert.match(logs[0]!, /attempt=1\/3 reason=none/);
    assert.match(logs[1]!, /attempt=2\/3 reason=found/);
  });

  it("gives up after three none attempts", async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const result = await detectOwnReplyToThreadWithRetry({
      threadId: "parent1",
      screenName: "me",
      delaysMs: [0, 2000, 5000],
      sleep: async (ms) => {
        sleeps.push(ms);
        return "ok";
      },
      log: () => {},
      searchTimelinePages: async () => {
        calls += 1;
        return {
          ok: true,
          threads: [],
          queryId: "q",
          bottomCursor: null,
        };
      },
    });
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [2000, 5000]);
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "none",
      rawCount: 0,
      matchCount: 0,
    });
  });

  it("does not retry ambiguous", async () => {
    let calls = 0;
    const result = await detectOwnReplyToThreadWithRetry({
      threadId: "parent1",
      screenName: "me",
      delaysMs: [0, 2000, 5000],
      sleep: async () => {
        throw new Error("should not sleep");
      },
      log: () => {},
      searchTimelinePages: async () => {
        calls += 1;
        return {
          ok: true,
          threads: [
            card({ id: "a", inReplyToId: "parent1" }),
            card({ id: "b", inReplyToId: "parent1" }),
          ],
          queryId: "q",
          bottomCursor: null,
        };
      },
    });
    assert.equal(calls, 1);
    assert.equal(result.reply, null);
    if (!result.reply) assert.equal(result.reason, "ambiguous");
  });

  it("stops without further search when aborted mid-backoff", async () => {
    let calls = 0;
    const ac = new AbortController();
    const result = await detectOwnReplyToThreadWithRetry({
      threadId: "parent1",
      screenName: "me",
      delaysMs: [0, 2000, 5000],
      signal: ac.signal,
      sleep: async () => {
        ac.abort();
        return "aborted";
      },
      log: () => {},
      searchTimelinePages: async () => {
        calls += 1;
        return {
          ok: true,
          threads: [],
          queryId: "q",
          bottomCursor: null,
        };
      },
    });
    assert.equal(calls, 1);
    assert.deepEqual(result, {
      ok: true,
      reply: null,
      reason: "none",
      rawCount: 0,
      matchCount: 0,
    });
  });
});
