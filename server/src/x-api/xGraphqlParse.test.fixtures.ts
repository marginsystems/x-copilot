export const tweetCardFixtures = {
  standard: {
    __typename: "Tweet",
    rest_id: "111",
    legacy: {
      full_text: "Hello from the fixture",
      created_at: "Sat Jul 25 00:00:00 +0000 2026",
      id_str: "111",
    },
    core: { user_results: { result: { core: { screen_name: "alice" } } } },
  },
  visible: {
    __typename: "TweetWithVisibilityResults",
    tweet: {
      rest_id: "222",
      legacy: { full_text: "Wrapped tweet", id_str: "222" },
      core: { user_results: { result: { legacy: { screen_name: "bob" } } } },
    },
  },
  note: {
    __typename: "Tweet",
    rest_id: "333",
    legacy: { full_text: "Short teaser https://t.co/abc", id_str: "333" },
    note_tweet: { note_tweet_results: { result: { text: "A".repeat(500) } } },
    core: { user_results: { result: { core: { screen_name: "carol" } } } },
  },
  article: {
    __typename: "Tweet",
    rest_id: "444",
    legacy: { full_text: "Article teaser only", id_str: "444" },
    article: { title: "Long form article" },
    core: { user_results: { result: { core: { screen_name: "dave" } } } },
  },
};

export const replyQuoteFixtures = {
  reply: {
    __typename: "Tweet",
    rest_id: "900",
    legacy: {
      full_text: "How do you pick which product to build?",
      id_str: "900",
      conversation_id_str: "800",
      in_reply_to_status_id_str: "800",
      in_reply_to_screen_name: "promo",
    },
    core: { user_results: { result: { core: { screen_name: "asker" } } } },
  },
  quote: {
    __typename: "Tweet",
    rest_id: "901",
    legacy: { full_text: "Curious how you got traffic?", id_str: "901" },
    core: { user_results: { result: { core: { screen_name: "curious" } } } },
    quoted_status_result: {
      result: {
        __typename: "Tweet",
        rest_id: "700",
        legacy: {
          full_text: "mysaas just crossed $632 in revenue, 100% profit",
          id_str: "700",
        },
        core: {
          user_results: { result: { core: { screen_name: "hustler" } } },
        },
      },
    },
  },
};
