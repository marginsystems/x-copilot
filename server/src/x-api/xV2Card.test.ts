import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseV2SearchPayload, v2TweetToCard } from "./xV2Card.ts";
import { filterOutboundLinks } from "../scout/threadFilters.ts";

await describe("v2TweetToCard replied_to includes", async () => {
  const usersById = new Map([
    ["u-reply", { id: "u-reply", username: "asker", name: "Asker" }],
    ["u-op", { id: "u-op", username: "hustler", name: "Hustler" }],
    ["u-mid", { id: "u-mid", username: "middler", name: "Middler" }],
  ]);

  await it("fills OP from includes.tweets and marks opParentDerived", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "mysaas just crossed $632 revenue",
          author_id: "u-op",
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "How do you pick products?",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "800" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.isReply, true);
    assert.equal(card.inReplyToId, "800");
    assert.equal(card.opAuthor, "@hustler");
    assert.match(card.opText ?? "", /\$632/);
    assert.equal(card.opParentDerived, true);
  });

  await it("copies impression counts onto the leaf and the OP", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "the real post",
          author_id: "u-op",
          created_at: "2026-09-05T05:00:00.000Z",
          public_metrics: { impression_count: 655 },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "yeah keep 80%",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "800" }],
        public_metrics: { impression_count: 5 },
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.views, 5);
    assert.equal(card.opViews, 655);
    assert.equal(card.opCreatedAt, "2026-09-05T05:00:00.000Z");
  });

  await it("flags a clean reply when the included OP has an off-platform link", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "New essay https://t.co/abc",
          author_id: "u-op",
          entities: {
            urls: [
              {
                url: "https://t.co/abc",
                expanded_url: "https://substack.com/p/hello",
              },
            ],
          },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "How do you pick products?",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "800" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.hasOutboundLink, true);
    assert.match(card.opText ?? "", /New essay/);
  });

  await it("flags a reply when the included OP is a note_tweet with an off-platform note link", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "teaser",
          author_id: "u-op",
          note_tweet: {
            text: "Long essay https://t.co/abc",
            entity_set: {
              urls: [
                {
                  url: "https://t.co/abc",
                  expanded_url: "https://substack.com/p/long",
                },
              ],
            },
          },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "How do you pick products?",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "800" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.hasOutboundLink, true);
    assert.match(card.opText ?? "", /Long essay/);
  });

  await it("flags a note_tweet candidate with an off-platform note entity link", () => {
    const card = v2TweetToCard(
      {
        id: "777",
        text: "preview",
        author_id: "u-op",
        note_tweet: {
          text: "Long-form post https://t.co/xyz",
          entity_set: {
            urls: [
              {
                url: "https://t.co/xyz",
                expanded_url: "https://github.com/foo/bar",
              },
            ],
          },
        },
      },
      usersById,
    );
    assert.ok(card);
    assert.equal(card.hasOutboundLink, true);
  });

  await it("does not crash when a quoted tweet is missing from includes.tweets", () => {
    const card = v2TweetToCard(
      {
        id: "999",
        text: "Quote tweet about the essay",
        author_id: "u-reply",
        referenced_tweets: [{ type: "quoted", id: "absent" }],
      },
      usersById,
    );
    assert.ok(card);
    assert.equal(card.isQuote, true);
    assert.equal(card.hasOutboundLink, undefined);
  });

  await it("flags a quote when the quoted tweet has an off-platform link", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "New essay https://t.co/abc",
          author_id: "u-op",
          entities: {
            urls: [
              {
                url: "https://t.co/abc",
                expanded_url: "https://substack.com/p/hello",
              },
            ],
          },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "This essay changed my mind",
        author_id: "u-reply",
        referenced_tweets: [{ type: "quoted", id: "800" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.isQuote, true);
    assert.equal(card.hasOutboundLink, true);
    assert.equal(filterOutboundLinks([card]).linkFilteredCount, 1);
  });

  await it("flags a quote when the quoted tweet has included native media", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "Photo post",
          author_id: "u-op",
          attachments: { media_keys: ["media-1"] },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "Commentary on the photo",
        author_id: "u-reply",
        referenced_tweets: [{ type: "quoted", id: "800" }],
      },
      usersById,
      tweetsById,
      new Set(["media-1"]),
    );
    assert.ok(card);
    assert.equal(card.opHasNativeMedia, true);
  });

  await it("marks v2 article payload as longform article", () => {
    const card = v2TweetToCard(
      {
        id: "444",
        text: "Article teaser only",
        author_id: "u-op",
        article: { title: "Long form", plain_text: "body" },
      },
      usersById,
    );
    assert.ok(card);
    assert.equal(card.longform, "article");
  });

  await it("marks /i/article/ entity URLs as articles", () => {
    const card = v2TweetToCard(
      {
        id: "445",
        text: "New piece",
        author_id: "u-op",
        entities: {
          urls: [{ expanded_url: "https://x.com/i/article/99" }],
        },
      },
      usersById,
    );
    assert.ok(card);
    assert.equal(card.longform, "article");
  });

  await it("does not treat a third-party /i/article/ link as an article", () => {
    const card = v2TweetToCard(
      {
        id: "446",
        text: "New piece",
        author_id: "u-op",
        entities: {
          urls: [{ expanded_url: "https://example.com/i/article/99" }],
        },
      },
      usersById,
    );
    assert.ok(card);
    assert.equal(card.longform, undefined);
  });

  await it("copies opLongform when the quoted tweet is an X Article", () => {
    const tweetsById = new Map([
      [
        "2095331355039285605",
        {
          id: "2095331355039285605",
          text: "https://t.co/qaGqed1cGP",
          author_id: "u-op",
          article: { title: "Ling 3.0 Flash Fin" },
          entities: {
            urls: [
              { expanded_url: "https://x.com/i/article/2095325328105414656" },
            ],
          },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "2095418466593390838",
        text: "The real value of AI lies not in drawing conclusions for us.",
        author_id: "u-reply",
        note_tweet: {
          text: "The real value of AI lies not in drawing conclusions for us.",
        },
        referenced_tweets: [
          { type: "quoted", id: "2095331355039285605" },
        ],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.isQuote, true);
    assert.equal(card.longform, "note_tweet");
    assert.equal(card.opLongform, "article");
    assert.equal(card.opAuthor, "@hustler");
  });

  await it("copies parent article longform and full char count from includes", () => {
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "teaser",
          author_id: "u-op",
          article: { title: "Essay" },
          note_tweet: { text: "n".repeat(600) },
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "How do you pick products?",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "800" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.opLongform, "article");
    assert.equal(card.opCharCount, 600);
    assert.equal(card.opText?.length, 500);
  });

  await it("prefers conversation root from includes when nested", () => {
    const tweetsById = new Map([
      [
        "850",
        {
          id: "850",
          text: "middle of the thread",
          author_id: "u-mid",
        },
      ],
      [
        "800",
        {
          id: "800",
          text: "why is Japan so behind in AI?",
          author_id: "u-op",
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "curious about this",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "850" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.opAuthor, "@hustler");
    assert.match(card.opText ?? "", /Japan/);
    assert.equal(card.opParentDerived, true);
  });

  await it("leaves opParentDerived unset when nested root is missing", () => {
    const tweetsById = new Map([
      [
        "850",
        {
          id: "850",
          text: "middle of the thread",
          author_id: "u-mid",
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "curious about this",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "850" }],
      },
      usersById,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.opAuthor, "@middler");
    assert.equal(card.opText, "middle of the thread");
    assert.equal(card.opParentDerived, undefined);
  });

  await it("does not set self-authored root as OP when parent is in data", () => {
    const replyUsers = new Map([
      ["u-reply", { id: "u-reply", username: "rooter", name: "Rooter" }],
      [
        "u-root",
        { id: "u-root", username: "rooter", name: "Rooter" },
      ],
    ]);
    const tweetsById = new Map([
      [
        "800",
        {
          id: "800",
          text: "my original thread",
          author_id: "u-root",
        },
      ],
    ]);
    const card = v2TweetToCard(
      {
        id: "900",
        text: "defending my thread",
        author_id: "u-reply",
        conversation_id: "800",
        referenced_tweets: [{ type: "replied_to", id: "850" }],
      },
      replyUsers,
      tweetsById,
    );
    assert.ok(card);
    assert.equal(card.isReply, true);
    assert.equal(card.inReplyToId, "850");
    assert.equal(card.opAuthor, undefined);
    assert.equal(card.opText, undefined);
    assert.equal(card.opParentDerived, undefined);
  });
});

/**
 * Real Take off miss: https://x.com/sasasenor/status/2092650080306119014
 * Reply text is clean commentary plus a native image t.co. The OP
 * (https://x.com/sergey_nog/status/2091161452241354978) rewrites Substack
 * through t.co — X entities.expanded_url is the follow-through.
 */
await describe("v2 outbound links from real t.co entities", async () => {
  const replyId = "2092650080306119014";
  const opId = "2091161452241354978";
  const users = [
    {
      id: "1750317907848863744",
      username: "sasasenor",
      name: "sahil",
    },
    {
      id: "1184496773970173952",
      username: "sergey_nog",
      name: "Sergey Gorbunov",
    },
  ];
  const replyTweet = {
    id: replyId,
    text: "@sergey_nog Great article. It summarizes the dark side of AI development really well but I think the part about people getting dumber is a bit grim; AI is affecting attention and the ability to engage in deep work more than anything but the ability to consume context, juggle tradeoffs... ctd https://t.co/zK5ZiEkdNn",
    author_id: "1750317907848863744",
    conversation_id: opId,
    in_reply_to_user_id: "1184496773970173952",
    referenced_tweets: [{ type: "replied_to" as const, id: opId }],
    entities: {
      urls: [
        {
          url: "https://t.co/zK5ZiEkdNn",
          expanded_url: `https://x.com/sasasenor/status/${replyId}/photo/1`,
          display_url: "pic.x.com/zK5ZiEkdNn",
        },
      ],
    },
  };
  const opTweet = {
    id: opId,
    text: "The End of Computers https://t.co/TxGWwcccfl",
    author_id: "1184496773970173952",
    entities: {
      urls: [
        {
          url: "https://t.co/TxGWwcccfl",
          expanded_url:
            "https://sergeynog.substack.com/p/the-end-of-computers",
          display_url: "sergeynog.substack.com/p/the-end-of-c…",
        },
      ],
    },
  };

  await it("does not treat the reply's own image t.co as outbound", () => {
    const { threads } = parseV2SearchPayload({
      data: [replyTweet],
      includes: { users },
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.hasOutboundLink, undefined);
    assert.deepEqual(threads[0]?.mediaShortlinks, ["t.co/zk5ziekdnn"]);
    assert.equal(filterOutboundLinks(threads).linkFilteredCount, 0);
  });

  await it("follows the OP t.co via expanded_url and drops the reply", () => {
    const { threads } = parseV2SearchPayload({
      data: [replyTweet],
      includes: { users, tweets: [opTweet] },
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.hasOutboundLink, true);
    assert.match(threads[0]?.opText ?? "", /The End of Computers/);
    const filtered = filterOutboundLinks(threads);
    assert.equal(filtered.threads.length, 0);
    assert.equal(filtered.linkFilteredCount, 1);
  });
});

/**
 * Real Take off miss: https://x.com/IssanCARefugee/status/2093404586795262199
 * Reply text is clean. The OP (https://x.com/RafaelDaVentys/status/2087820145578103161)
 * has no entities.urls — only tweet.fields=card_uri → card://2087820143858499584
 * (website card “From daventys.com”). v2 never returns that landing URL.
 */
await describe("v2 outbound links from official card_uri", async () => {
  const replyId = "2093404586795262199";
  const opId = "2087820145578103161";
  const cardUri = "card://2087820143858499584";
  const users = [
    {
      id: "1675619540104019968",
      username: "IssanCARefugee",
      name: "IssanCali",
    },
    {
      id: "1898190900041265152",
      username: "RafaelDaVentys",
      name: "Rafael DaVentys",
    },
  ];
  const replyTweet = {
    id: replyId,
    text: "@RafaelDaVentys I was in it 6 yrs, '99-'04, SV tech sales. Biggest probs were:\n1. Startups, sketchy funding, unpaid invoices.\n2. Joker wannabes, like the \"record company CEO\" talking a big game trying for free gear.\n3. Running to shipping to pack/load stuff myself to get it out.\n4. Waste of time",
    author_id: "1675619540104019968",
    conversation_id: opId,
    in_reply_to_user_id: "1898190900041265152",
    referenced_tweets: [{ type: "replied_to" as const, id: opId }],
    entities: { urls: [] as { expanded_url?: string }[] },
  };
  const opTweet = {
    id: opId,
    text: "I spent five years in corporate sales.\n\n(If you've worked under fluorescent lights, you know The Office isn't a comedy. It's a documentary)\n\nThose years taught me a new language: Corporatish.\n\nFor example, when someone tells you: \"As I told you in my previous email..\"\n\nIt means..",
    author_id: "1898190900041265152",
    card_uri: cardUri,
    entities: { urls: [] as { expanded_url?: string }[] },
  };

  await it("does not treat the clean reply as outbound on its own", () => {
    const { threads } = parseV2SearchPayload({
      data: [replyTweet],
      includes: { users },
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.id, replyId);
    assert.equal(threads[0]?.hasOutboundLink, undefined);
    assert.equal(filterOutboundLinks(threads).linkFilteredCount, 0);
  });

  await it("drops the reply when the OP has a card_uri and no URL entities", () => {
    const { threads } = parseV2SearchPayload({
      data: [replyTweet],
      includes: { users, tweets: [opTweet] },
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.hasOutboundLink, true);
    assert.match(threads[0]?.opText ?? "", /Corporatish/);
    const filtered = filterOutboundLinks(threads);
    assert.equal(filtered.threads.length, 0);
    assert.equal(filtered.linkFilteredCount, 1);
  });

  await it("keeps the card OP when dropOutboundLinks is off", () => {
    const { threads } = parseV2SearchPayload({
      data: [replyTweet],
      includes: { users, tweets: [opTweet] },
    });
    const kept = filterOutboundLinks(threads, { dropOutboundLinks: false });
    assert.equal(kept.threads.length, 1);
    assert.equal(kept.linkFilteredCount, 0);
    assert.equal(kept.threads[0]?.id, replyId);
  });
});

await describe("parseV2SearchPayload boundary validation", async () => {
  await it("rejects results without string identity fields or users", () => {
    const result = parseV2SearchPayload({
      data: [
        { id: 42, text: "valid text", author_id: "u1" },
        { id: "43", text: 7, author_id: "u1" },
        { id: "44", text: "valid text", author_id: "u2" },
        { id: "46", text: "valid text", author_id: "u1" },
      ],
      includes: { users: [{ id: "u1", username: 9 }] },
    });
    assert.deepEqual(result.threads, []);
  });

  await it("keeps valid results when optional values have off-type contents", () => {
    const result = parseV2SearchPayload({
      data: [
        {
          id: "45",
          text: "A sparse result",
          author_id: "u1",
          entities: { urls: [{ url: 123 }] },
          public_metrics: { impression_count: "5" },
        },
      ],
      includes: { users: [{ id: "u1", username: "author" }] },
    });
    assert.equal(result.threads.length, 1);
    assert.equal(result.threads[0]?.id, "45");
    assert.equal(result.threads[0]?.views, undefined);
  });

  await it("preserves sparse results, opaque article data, unknown fields and pagination", () => {
    const tweet = {
      id: "42",
      text: "An article",
      author_id: "u1",
      article: { title: "An article", futureField: [1, 2] },
      futureField: { enabled: true },
    };
    const user = { id: "u1", username: "author", futureField: true };
    const result = parseV2SearchPayload({
      data: [tweet],
      includes: { users: [user] },
      meta: { next_token: " next-page " },
    });
    assert.deepEqual(result.threads, [v2TweetToCard(tweet, new Map([["u1", user]]))]);
    assert.equal(result.nextToken, "next-page");
    assert.deepEqual(parseV2SearchPayload({ meta: {} }), { threads: [], nextToken: null });
  });
});
