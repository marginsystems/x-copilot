import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeThreads,
  parseSearchTimelineResponse,
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
                  entryId: "cursor-bottom",
                  content: { __typename: "TimelineTimelineCursor" },
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
