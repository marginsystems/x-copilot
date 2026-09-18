import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  tweetResultToCard,
  userIsAutomated,
} from "./xGraphqlParse.ts";
import {
  replyQuoteFixtures,
  tweetCardFixtures,
} from "./xGraphqlParse.test.fixtures.ts";

describe("tweetResultToCard", () => {
  it("builds author and URL fields from raw tweets", () => {
    assert.deepEqual(tweetResultToCard(tweetCardFixtures.standard), {
      id: "111",
      author: "@alice",
      text: "Hello from the fixture",
      url: "https://x.com/alice/status/111",
      createdAt: "Sat Jul 25 00:00:00 +0000 2026",
    });
    const visible = tweetResultToCard(tweetCardFixtures.visible);
    assert.equal(visible?.id, "222");
    assert.equal(visible?.author, "@bob");
    assert.equal(visible?.url, "https://x.com/bob/status/222");
  });

  it("prefers note_tweet body over short full_text teaser", () => {
    const note = tweetResultToCard(tweetCardFixtures.note);
    assert.ok(note);
    assert.equal(note.longform, "note_tweet");
    assert.equal(note.text.length, 500);
    assert.equal(note.author, "@carol");
  });

  it("marks article payload as longform article", () => {
    const article = tweetResultToCard(tweetCardFixtures.article);
    assert.ok(article);
    assert.equal(article.longform, "article");
    assert.equal(article.text, "Article teaser only");
  });

  it("marks AutomatedLabel authors as isAutomated", () => {
    const automated = {
      __typename: "Tweet",
      rest_id: "555",
      legacy: { full_text: "bot post", id_str: "555" },
      core: {
        user_results: {
          result: {
            core: { screen_name: "SimonVelaWrites" },
            affiliates_highlighted_label: {
              label: {
                description: "Automated",
                userLabelType: "AutomatedLabel",
                longDescription: { text: "Automated by @KineticElle" },
              },
            },
          },
        },
      },
    };
    assert.equal(userIsAutomated(automated), true);
    assert.equal(tweetResultToCard(automated)?.isAutomated, true);

    const affiliateOnly = {
      __typename: "Tweet",
      rest_id: "556",
      legacy: { full_text: "brand post", id_str: "556" },
      core: {
        user_results: {
          result: {
            core: { screen_name: "brandbot" },
            affiliates_highlighted_label: {
              label: {
                description: "Acme Corp",
                userLabelType: "BusinessLabel",
              },
            },
          },
        },
      },
    };
    assert.equal(userIsAutomated(affiliateOnly), false);
    assert.equal(tweetResultToCard(affiliateOnly)?.isAutomated, undefined);

    const nonAutomatedWithDescription = {
      __typename: "Tweet",
      rest_id: "557",
      legacy: { full_text: "brand post", id_str: "557" },
      core: {
        user_results: {
          result: {
            core: { screen_name: "brandbot" },
            affiliates_highlighted_label: {
              label: {
                description: "Automated",
                userLabelType: "BusinessLabel",
              },
            },
          },
        },
      },
    };
    assert.equal(userIsAutomated(nonAutomatedWithDescription), false);
    assert.equal(
      tweetResultToCard(nonAutomatedWithDescription)?.isAutomated,
      undefined,
    );

    const automatedNoType = {
      __typename: "Tweet",
      rest_id: "558",
      legacy: { full_text: "bot post", id_str: "558" },
      core: {
        user_results: {
          result: {
            core: { screen_name: "SimonVelaWrites" },
            affiliates_highlighted_label: {
              label: { description: "Automated" },
            },
          },
        },
      },
    };
    assert.equal(userIsAutomated(automatedNoType), true);
  });

  it("parses reply metadata and quoted OP context", () => {
    const reply = tweetResultToCard(replyQuoteFixtures.reply);
    assert.ok(reply);
    assert.equal(reply.isReply, true);
    assert.equal(reply.inReplyToId, "800");
    assert.equal(reply.inReplyToScreenName, "@promo");
    assert.equal(reply.conversationId, "800");
    assert.equal(reply.opText, undefined);

    const quote = tweetResultToCard(replyQuoteFixtures.quote);
    assert.ok(quote);
    assert.equal(quote.opAuthor, "@hustler");
    assert.match(quote.opText ?? "", /\$632/);
  });

  it("marks a quote of an X Article with opLongform", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "901",
      legacy: { full_text: "The real value of AI", id_str: "901" },
      core: {
        user_results: { result: { core: { screen_name: "AlmustyFX" } } },
      },
      quoted_status_result: {
        result: {
          __typename: "Tweet",
          rest_id: "800",
          article: { title: "Ling 3.0 Flash Fin" },
          legacy: {
            full_text: "https://t.co/qaGqed1cGP",
            id_str: "800",
          },
          core: {
            user_results: { result: { core: { screen_name: "qtdevlop" } } },
          },
        },
      },
    });
    assert.ok(card);
    assert.equal(card.isQuote, true);
    assert.equal(card.opLongform, "article");
    assert.equal(card.opAuthor, "@qtdevlop");
  });

  it("flags a quote when the quoted tweet has an off-platform link", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "901",
      legacy: { full_text: "This is the key bit", id_str: "901" },
      core: {
        user_results: { result: { core: { screen_name: "alice" } } },
      },
      quoted_status_result: {
        result: {
          __typename: "Tweet",
          rest_id: "800",
          legacy: {
            full_text: "New essay https://t.co/abc",
            id_str: "800",
            entities: {
              urls: [
                {
                  url: "https://t.co/abc",
                  expanded_url: "https://substack.com/p/hello",
                },
              ],
            },
          },
          core: {
            user_results: { result: { core: { screen_name: "writer" } } },
          },
        },
      },
    });
    assert.ok(card);
    assert.equal(card.hasOutboundLink, true);
    assert.match(card.opText ?? "", /New essay/);
  });
});
