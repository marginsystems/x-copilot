import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tweetResultToCard } from "./xGraphqlParse.ts";
import {
  hasCardUri,
  isNativeMediaUrl,
  isOutboundLinkUrl,
  isXArticleUrl,
  textHasOutboundLink,
} from "./xLinks.ts";

describe("hasCardUri", () => {
  it("treats any official v2 card_uri as a card", () => {
    assert.equal(hasCardUri("card://2087820143858499584"), true);
    assert.equal(hasCardUri("  card://1  "), true);
    assert.equal(hasCardUri(""), false);
    assert.equal(hasCardUri(undefined), false);
    assert.equal(hasCardUri(null), false);
  });
});

describe("isXArticleUrl", () => {
  it("matches native X Article permalinks", () => {
    assert.equal(isXArticleUrl("https://x.com/i/article/99"), true);
    assert.equal(isXArticleUrl("https://twitter.com/i/article/99?s=20"), true);
    assert.equal(isXArticleUrl("https://x.com/dave/status/444"), false);
    assert.equal(isXArticleUrl("https://example.com/i/article/99"), false);
  });
});

describe("outbound link detection", () => {
  it("classifies media vs outbound URLs", () => {
    assert.equal(isNativeMediaUrl("https://pic.twitter.com/abc"), true);
    assert.equal(isNativeMediaUrl("https://pic.x.com/zK5ZiEkdNn"), true);
    assert.equal(isNativeMediaUrl("https://pbs.twimg.com/media/x.jpg"), true);
    assert.equal(isOutboundLinkUrl("https://pic.x.com/zK5ZiEkdNn"), false);
    assert.equal(isNativeMediaUrl("https://example.com/x"), false);
    assert.equal(isOutboundLinkUrl("https://t.co/abc"), true);
    assert.equal(isOutboundLinkUrl("https://pic.twitter.com/abc"), false);
    assert.equal(isOutboundLinkUrl("https://x.com/dave/status/444"), false);
    assert.equal(isOutboundLinkUrl("https://twitter.com/dave/status/444"), false);
    assert.equal(isOutboundLinkUrl("https://www.x.com/dave/status/444"), false);
    assert.equal(
      isOutboundLinkUrl("https://mobile.twitter.com/dave/status/444"),
      false,
    );
    assert.equal(isOutboundLinkUrl("https://substack.com/p/hello"), true);
    assert.equal(textHasOutboundLink("see https://x.com/dave/status/444"), false);
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

  it("flags outbound URLs in note_tweet body entity_set", () => {
    const card = tweetResultToCard({
      __typename: "Tweet",
      rest_id: "509",
      legacy: {
        full_text: "Long post teaser",
        id_str: "509",
        entities: { urls: [] },
      },
      note_tweet: {
        note_tweet_results: {
          result: {
            text: "A long post https://t.co/longOutbound",
            entity_set: {
              urls: [
                {
                  url: "https://t.co/longOutbound",
                  expanded_url: "https://github.com/acme/tool",
                  display_url: "github.com/acme/tool",
                },
              ],
            },
          },
        },
      },
      core: {
        user_results: { result: { core: { screen_name: "noteLink" } } },
      },
    });
    assert.ok(card);
    assert.equal(card.longform, "note_tweet");
    assert.equal(card.hasOutboundLink, true);
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
