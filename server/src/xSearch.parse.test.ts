import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveWithinTime,
  searchExpansions,
  searchTimelinePages,
  withSearchRecency,
} from "./xSearch.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("withSearchRecency / resolveWithinTime", () => {
  it("appends within_time by default", () => {
    assert.equal(
      withSearchRecency("shipping AI", "6h"),
      "shipping AI within_time:6h",
    );
  });

  it("does not double-append time operators", () => {
    assert.equal(
      withSearchRecency("foo within_time:3h", "6h"),
      "foo within_time:3h",
    );
    assert.equal(withSearchRecency("foo since:2026-01-01", "6h"), "foo since:2026-01-01");
  });

  it("clamps invalid env to 6h", () => {
    assert.equal(resolveWithinTime(""), "6h");
    assert.equal(resolveWithinTime("nope"), "6h");
    assert.equal(resolveWithinTime("48h"), "6h");
    assert.equal(resolveWithinTime("12h"), "12h");
    assert.equal(resolveWithinTime("90m"), "90m");
  });
});

describe("searchTimelinePages", () => {
  function card(id: string): ThreadCard {
    return {
      id,
      author: "@a",
      text: `t${id}`,
      url: `https://x.com/a/status/${id}`,
    };
  }

  it("follows Bottom cursor up to 3 pages", async () => {
    const calls: Array<string | undefined> = [];
    const result = await searchTimelinePages({
      query: "builders",
      pageDelayMs: 0,
      fetchPage: async (opts) => {
        calls.push(opts.cursor);
        const page = calls.length;
        return {
          ok: true as const,
          queryId: "qid",
          threads: [card(String(page))],
          bottomCursor: page < 3 ? `c${page}` : null,
        };
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.pages, 3);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["1", "2", "3"],
    );
    assert.deepEqual(calls, [undefined, "c1", "c2"]);
    assert.match(withSearchRecency("builders"), /within_time:/);
  });

  it("honors maxPages: 1 even when a cursor remains", async () => {
    let pages = 0;
    const result = await searchTimelinePages({
      query: "q",
      maxPages: 1,
      pageDelayMs: 0,
      fetchPage: async () => {
        pages += 1;
        return {
          ok: true as const,
          queryId: "qid",
          threads: [card("one")],
          bottomCursor: "more",
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(pages, 1);
    if (result.ok) assert.equal(result.pages, 1);
  });

  it("reduced expansions drop referenced-tweet parent objects", () => {
    assert.match(searchExpansions(true), /referenced_tweets\.id/);
    assert.doesNotMatch(searchExpansions(false), /referenced_tweets/);
  });

  it("stops early when cursor is null", async () => {
    let pages = 0;
    const result = await searchTimelinePages({
      query: "q",
      pageDelayMs: 0,
      fetchPage: async () => {
        pages += 1;
        return {
          ok: true as const,
          queryId: "qid",
          threads: [card("only")],
          bottomCursor: null,
        };
      },
    });
    assert.equal(result.ok, true);
    assert.equal(pages, 1);
    if (result.ok) assert.equal(result.pages, 1);
  });

  it("aborts when signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await searchTimelinePages({
      query: "q",
      signal: ac.signal,
      pageDelayMs: 0,
      fetchPage: async () => {
        throw new Error("should not fetch");
      },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error, "client_disconnected");
  });
});
