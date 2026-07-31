import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  dedupeThreads,
  isNativeMediaUrl,
  isOutboundLinkUrl,
  parseSearchTimelinePage,
  parseSearchTimelineResponse,
  resolveWithinTime,
  searchTimelinePages,
  textHasOutboundLink,
  tweetResultToCard,
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

const replyQuoteFixture = {
  data: {
    search_by_raw_query: {
      search_timeline: {
        timeline: {
          instructions: [
            {
              entries: [
                {
                  entryId: "tweet-reply",
                  content: {
                    __typename: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "900",
                          legacy: {
                            full_text: "How do you pick which product to build?",
                            id_str: "900",
                            conversation_id_str: "800",
                            in_reply_to_status_id_str: "800",
                            in_reply_to_screen_name: "promo",
                          },
                          core: {
                            user_results: {
                              result: {
                                core: { screen_name: "asker" },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
                {
                  entryId: "tweet-quote",
                  content: {
                    __typename: "TimelineTimelineItem",
                    itemContent: {
                      tweet_results: {
                        result: {
                          __typename: "Tweet",
                          rest_id: "901",
                          legacy: {
                            full_text: "Curious how you got traffic?",
                            id_str: "901",
                          },
                          core: {
                            user_results: {
                              result: {
                                core: { screen_name: "curious" },
                              },
                            },
                          },
                          quoted_status_result: {
                            result: {
                              __typename: "Tweet",
                              rest_id: "700",
                              legacy: {
                                full_text:
                                  "mysaas just crossed $632 in revenue, 100% profit",
                                id_str: "700",
                              },
                              core: {
                                user_results: {
                                  result: {
                                    core: { screen_name: "hustler" },
                                  },
                                },
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

  it("parses reply metadata and quoted OP context", () => {
    const threads = parseSearchTimelineResponse(replyQuoteFixture);
    assert.equal(threads.length, 2);
    const reply = threads.find((t) => t.id === "900");
    assert.ok(reply);
    assert.equal(reply.isReply, true);
    assert.equal(reply.inReplyToId, "800");
    assert.equal(reply.inReplyToScreenName, "@promo");
    assert.equal(reply.conversationId, "800");
    assert.equal(reply.opText, undefined);

    const quote = threads.find((t) => t.id === "901");
    assert.ok(quote);
    assert.equal(quote.opAuthor, "@hustler");
    assert.match(quote.opText ?? "", /\$632/);
  });
});

describe("outbound link detection", () => {
  it("classifies media vs outbound URLs", () => {
    assert.equal(isNativeMediaUrl("https://pic.twitter.com/abc"), true);
    assert.equal(isNativeMediaUrl("https://pbs.twimg.com/media/x.jpg"), true);
    assert.equal(isNativeMediaUrl("https://example.com/x"), false);
    assert.equal(isOutboundLinkUrl("https://t.co/abc"), true);
    assert.equal(isOutboundLinkUrl("https://pic.twitter.com/abc"), false);
    assert.equal(textHasOutboundLink("see https://github.com/x"), true);
    assert.equal(textHasOutboundLink("bare t.co/AbCdEf"), false);
    assert.equal(textHasOutboundLink("thanks @alice"), false);
    assert.equal(
      textHasOutboundLink("pic https://pic.twitter.com/abc only"),
      false,
    );
  });

  it("flags entities.urls on parse", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "501",
      legacy: {
        full_text: "I built this",
        id_str: "501",
        entities: {
          urls: [
            {
              url: "https://t.co/xyz",
              expanded_url: "https://github.com/acme/tool",
              display_url: "github.com/acme/tool",
            },
          ],
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "builder" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, true);
  });

  it("does not flag bare t.co in full_text when entities are absent", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "502",
      legacy: {
        full_text: "Launch post https://t.co/abc123",
        id_str: "502",
      },
      core: {
        user_results: { result: { core: { screen_name: "shipper" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, undefined);
  });

  it("does not flag clean text", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "503",
      legacy: {
        full_text: "How do you pick which product to build?",
        id_str: "503",
      },
      core: {
        user_results: { result: { core: { screen_name: "curious" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, undefined);
  });

  it("does not flag media-only entity URLs (even with t.co in text)", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "504",
      legacy: {
        full_text: "Screenshot https://t.co/media1",
        id_str: "504",
        entities: {
          urls: [
            {
              url: "https://t.co/media1",
              expanded_url: "https://pic.twitter.com/media1",
              display_url: "pic.twitter.com/media1",
            },
          ],
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "media" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, undefined);
  });

  it("does not flag media shortlinks in note_tweet body entities", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "505",
      legacy: {
        full_text: "Long post teaser",
        id_str: "505",
        entities: { urls: [] },
      },
      note_tweet: {
        note_tweet_results: {
          result: {
            text: "A long image post https://t.co/mediaNote",
            entity_set: {
              urls: [
                {
                  url: "https://t.co/mediaNote",
                  expanded_url: "https://pic.twitter.com/mediaNote",
                  display_url: "pic.twitter.com/mediaNote",
                },
              ],
            },
          },
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "noteMedia" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.longform, "note_tweet");
    assert.equal(card.hasOutboundLink, undefined);
  });

  it("does not flag media-only posts via legacy.entities.media", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "506",
      legacy: {
        full_text: "Photo dump https://t.co/mediaReal",
        id_str: "506",
        entities: {
          urls: [],
          media: [
            {
              url: "https://t.co/mediaReal",
              expanded_url:
                "https://twitter.com/mediaReal/status/506/photo/1",
              display_url: "pic.twitter.com/mediaReal",
            },
          ],
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "mediaReal" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, undefined);
    assert.deepEqual(card.mediaShortlinks, ["t.co/mediareal"]);
  });

  it("does not flag media URL entities with twitter.com photo expanded_url", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "508",
      legacy: {
        full_text: "Photo https://t.co/mediaTwitter",
        id_str: "508",
        entities: {
          urls: [
            {
              url: "https://t.co/mediaTwitter",
              expanded_url:
                "https://twitter.com/mediaTwitter/status/508/photo/1",
              display_url: "pic.twitter.com/mediaTwitter",
            },
          ],
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "mediaTwitter" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, undefined);
    assert.deepEqual(card.mediaShortlinks, ["t.co/mediatwitter"]);
  });

  it("does not flag note_tweet media via entity_set.media", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "507",
      legacy: {
        full_text: "Long post teaser",
        id_str: "507",
        entities: { urls: [] },
      },
      note_tweet: {
        note_tweet_results: {
          result: {
            text: "A long image post https://t.co/mediaNoteReal",
            entity_set: {
              urls: [],
              media: [
                {
                  url: "https://t.co/mediaNoteReal",
                  expanded_url:
                    "https://twitter.com/noteMedia/status/507/photo/1",
                  display_url: "pic.twitter.com/mediaNoteReal",
                },
              ],
            },
          },
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "noteMedia" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.longform, "note_tweet");
    assert.equal(card.hasOutboundLink, undefined);
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
