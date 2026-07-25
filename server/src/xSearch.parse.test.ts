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
    assert.equal(threads.length, 2);
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
