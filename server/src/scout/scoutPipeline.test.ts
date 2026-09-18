import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterPostHydrateThreads } from "./scoutPipeline.ts";
import { card } from "./scoutCollect.testHelpers.ts";

describe("filterPostHydrateThreads", () => {
  it("keeps replies without a root view count for hydration", () => {
    const unknown = card({
      id: "unknown",
      isReply: true,
      inReplyToId: "root",
      views: 1,
    });
    const provisional = card({
      id: "provisional",
      isReply: true,
      inReplyToId: "root",
      opViews: 1,
    });
    const lowRoot = card({ id: "low", views: 99 });
    const result = filterPostHydrateThreads({
      threads: [unknown, provisional, lowRoot],
      preferredLanguage: "en",
      maxChars: 480,
    });

    assert.deepEqual(
      result.afterMinViews.threads.map((thread) => thread.id),
      ["unknown", "provisional"],
    );
    assert.equal(result.afterMinViews.minViewsFilteredCount, 1);
  });

  it("preserves the shared self-reply, language, and length order", () => {
    const spanish =
      "Ahora que todos están quejándose de build in public, dejé de hacerlo porque copiaban literalmente todo lo que publicábamos.";
    const result = filterPostHydrateThreads({
      threads: [
        card({
          id: "self",
          author: "@pilot",
          isReply: true,
          inReplyToId: "self-root",
          opAuthor: "@pilot",
          opParentDerived: true,
        }),
        card({ id: "spanish", text: spanish }),
        card({
          id: "article-reply",
          isReply: true,
          inReplyToId: "article-root",
        }),
        card({
          id: "long",
          text: "This candidate is deliberately much longer than the configured cap.",
        }),
        card({ id: "kept", text: "Useful question about shipping loops." }),
      ],
      preferredLanguage: "en",
      maxChars: 50,
      lengthOptions: {
        dropArticles: true,
        articleIds: new Set(["article-root"]),
      },
    });

    assert.deepEqual(
      result.afterSelfReply.threads.map((thread) => thread.id),
      ["spanish", "article-reply", "long", "kept"],
    );
    assert.equal(result.afterSelfReply.selfReplyFilteredCount, 1);
    assert.deepEqual(
      result.afterLanguage.threads.map((thread) => thread.id),
      ["article-reply", "long", "kept"],
    );
    assert.equal(result.afterLanguage.languageFilteredCount, 1);
    assert.deepEqual(
      result.afterLength.threads.map((thread) => thread.id),
      ["kept"],
    );
    assert.equal(result.afterLength.filteredCount, 2);
    assert.equal(result.afterLength.articleFilteredCount, 1);
  });

  it("drops replies whose hydrated OP has native media or a hashtag", () => {
    const result = filterPostHydrateThreads({
      threads: [
        card({
          id: "media-reply",
          text: "Agree, ship weekly.",
          isReply: true,
          inReplyToId: "media-root",
          opText: "Dump pic.twitter.com/zk5ziekdnn",
          opParentDerived: true,
        }),
        card({
          id: "tag-reply",
          text: "Same.",
          isReply: true,
          inReplyToId: "tag-root",
          opText: "Hiring notes #buildinpublic",
          opParentDerived: true,
        }),
        card({ id: "kept", text: "Useful question about shipping loops." }),
      ],
      preferredLanguage: "en",
      maxChars: 480,
    });
    assert.deepEqual(
      result.afterHashtags.threads.map((thread) => thread.id),
      ["kept"],
    );
    assert.equal(result.afterMedia.mediaFilteredCount, 1);
    assert.equal(result.afterHashtags.hashtagFilteredCount, 1);
  });

  it("drops replies whose hydrated OP has an off-platform link", () => {
    const result = filterPostHydrateThreads({
      threads: [
        card({
          id: "promo-reply",
          text: "Agree, ship weekly.",
          isReply: true,
          inReplyToId: "promo-root",
          opAuthor: "@writer",
          opText: "Read the rest https://substack.com/p/hello",
          opParentDerived: true,
        }),
        card({ id: "kept", text: "Useful question about shipping loops." }),
      ],
      preferredLanguage: "en",
      maxChars: 480,
    });
    assert.deepEqual(
      result.afterLinks.threads.map((thread) => thread.id),
      ["kept"],
    );
    assert.equal(result.afterLinks.linkFilteredCount, 1);
  });

  it("drops replies whose hydrated OP has profanity", () => {
    const result = filterPostHydrateThreads({
      threads: [
        card({
          id: "swear-reply",
          text: "Agree, ship weekly.",
          isReply: true,
          inReplyToId: "swear-root",
          opAuthor: "@writer",
          opText: "this deploy is shit",
          opParentDerived: true,
        }),
        card({ id: "kept", text: "Useful question about shipping loops." }),
      ],
      preferredLanguage: "en",
      maxChars: 480,
    });
    assert.deepEqual(
      result.afterProfanity.threads.map((thread) => thread.id),
      ["kept"],
    );
    assert.equal(result.afterProfanity.profanityFilteredCount, 1);
  });
});
