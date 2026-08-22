export const searchTimelineFixture = {
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

export const replyQuoteFixture = {
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
