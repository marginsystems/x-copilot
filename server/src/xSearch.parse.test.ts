import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeThreads,
  parseSearchTimelinePage,
  parseSearchTimelineResponse,
  resolveWithinTime,
  searchTimelinePages,
  withSearchRecency,
  type ThreadCard,
} from "./xSearch.ts";

const fixture = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              entries: [
                {
                  entryId: "tweet-111",
                  content: {
                    __typename: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "111",
                          legacy: {
                            full_text: "Hello from the fixture",
                            created_at: "Sat Jul 25 00:00:00 +0000 2026",
                            id_str: "111",
                          },
                          core: {
                            user_results: {
                              result: {
                                core: { screen_name: "alice" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "tweet-222",
                  content: {
                    __typename: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "TweetWithVisibilityResults",
                          tweet: {
                            rest_id: "222",
                            legacy: {
                              full_text: "Wrapped tweet",
                              id_str: "222",
                            },
                            core: {
                              user_results: {
                                result: {
                                  legacy: { screen_name: "bob" },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "cursor-bottom-0",
                  content: {
                    __typename: "TimelineTimelineCursor",
                    cursorType: "Bottom",
                    value: "scroll:test-cursor-abc",
                  },
                },
                {
                  entryId: "tweet-333",
                  content: {
                    __typename: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "333",
                          legacy: {
                            full_text: "Short teaser https://t.co/abc",
                            created_at: "Sat Jul 25 01:00:00 +0000 2026",
                            id_str: "333",
                          },
                          note_tweet: {
                            note_tweet_results: {
                              result: {
                                text: "A".repeat(500),
                              },
                            },
                          },
                          core: {
                            user_results: {
                              result: {
                                core: { screen_name: "carol" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "tweet-444",
                  content: {
                    __typename: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "444",
                          legacy: {
                            full_text: "Article teaser only",
                            id_str: "444",
                          },
                          article: {
                            title: "Long form article",
                          },
                          core: {
                            user_results: {
                              result: {
                                core: { screen_name: "dave" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
  },
};

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

describe("parseSearchTimelinePage", () => {
  it("extracts Bottom cursor", () => {
    const page = parseSearchTimelinePage(fixture);
    assert.equal(page.bottomCursor, "scroll:test-cursor-abc");
    assert.equal(page.threads.length, 4);
  });
});

describe("parseSearchTimelineResponse", () => {
  it("extracts tweets and builds urls", () => {
    const threads = parseSearchTimelineResponse(fixture);
    assert.equal(threads.length, 4);
    assert.deepEqual(threads[0], {
      id: "111",
      author: "@alice",
      text: "Hello from the fixture",
      url: "https://x.com/alice/status/111",
      createdAt: "Sat Jul 25 00:00:00 +0000 2026",
    });
    assert.equal(threads[1].id, "222");
    assert.equal(threads[1].author, "@bob");
    assert.equal(threads[1].url, "https://x.com/bob/status/222");
  });

  it("prefers note_tweet body over short full_text teaser", () => {
    const threads = parseSearchTimelineResponse(fixture);
    const note = threads.find((t) => t.id === "333");
    assert.ok(note);
    assert.equal(note.longform, "note_tweet");
    assert.equal(note.text.length, 500);
    assert.equal(note.author, "@carol");
  });

  it("marks article payload as longform article", () => {
    const threads = parseSearchTimelineResponse(fixture);
    const article = threads.find((t) => t.id === "444");
    assert.ok(article);
    assert.equal(article.longform, "article");
    assert.equal(article.text, "Article teaser only");
  });

  it("returns empty for missing data", () => {
    assert.deepEqual(parseSearchTimelineResponse({}), []);
  });
});

describe("dedupeThreads", () => {
  it("keeps first occurrence by id", () => {
    const input: ThreadCard[] = [
      {
        id: "1",
        author: "@a",
        text: "one",
        url: "https://x.com/a/status/1",
      },
      {
        id: "1",
        author: "@a",
        text: "dup",
        url: "https://x.com/a/status/1",
      },
      {
        id: "2",
        author: "@b",
        text: "two",
        url: "https://x.com/b/status/2",
      },
    ];
    const out = dedupeThreads(input);
    assert.equal(out.length, 2);
    assert.equal(out[0].text, "one");
    assert.equal(out[1].id, "2");
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
