import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseV2SearchPayload, v2TweetToCard } from "./xV2Card.ts";
import { filterOutboundLinks } from "./threadFilters.ts";

describe("v2TweetToCard replied_to includes", () => {
  const usersById = new Map([
    ["u-reply", { id: "u-reply", username: "asker", name: "Asker" }],
    ["u-op", { id: "u-op", username: "hustler", name: "Hustler" }],
    ["u-mid", { id: "u-mid", username: "middler", name: "Middler" }],
  ]);

  it("fills OP from includes.tweets and marks opParentDerived", () => {
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

  it("flags a clean reply when the included OP has an off-platform link", () => {
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

  it("marks v2 article payload as longform article", () => {
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

  it("marks /i/article/ entity URLs as articles", () => {
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

  it("does not treat a third-party /i/article/ link as an article", () => {
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

  it("copies parent article longform and full char count from includes", () => {
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

  it("prefers conversation root from includes when nested", () => {
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

  it("leaves opParentDerived unset when nested root is missing", () => {
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

  it("does not set self-authored root as OP when parent is in data", () => {
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
describe("v2 outbound links from real t.co entities", () => {
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

  it("does not treat the reply's own image t.co as outbound", () => {
    const { threads } = parseV2SearchPayload({
      data: [replyTweet],
      includes: { users },
    });
    assert.equal(threads.length, 1);
    assert.equal(threads[0]?.hasOutboundLink, undefined);
    assert.deepEqual(threads[0]?.mediaShortlinks, ["t.co/zk5ziekdnn"]);
    assert.equal(filterOutboundLinks(threads).linkFilteredCount, 0);
  });

  it("follows the OP t.co via expanded_url and drops the reply", () => {
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
