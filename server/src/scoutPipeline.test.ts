import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterPostHydrateThreads } from "./scoutPipeline.ts";
import { card } from "./scoutCollect.testHelpers.ts";

describe("filterPostHydrateThreads", () => {
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
});
