import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  forYouKindLabel,
  forYouOpenUrl,
  parseForYouSuggestion,
  type ForYouSuggestion,
} from "./forYou.ts";

const base: ForYouSuggestion = {
  id: "s1",
  kind: "post",
  why: "900 views",
  draft: "Ship a recap.",
  targetId: null,
  targetUrl: null,
  targetAuthor: null,
};

describe("forYou helpers", () => {
  it("parses API rows and rejects junk", () => {
    assert.equal(parseForYouSuggestion(null), null);
    assert.equal(parseForYouSuggestion({ id: "1", kind: "nope", why: "x" }), null);
    const row = parseForYouSuggestion({
      id: "s1",
      kind: "quote",
      why: "quote the winner",
      draft: "still true",
      targetId: "10",
      targetUrl: "https://x.com/desk/status/10",
    });
    assert.equal(row?.kind, "quote");
    assert.equal(row?.targetId, "10");
  });

  it("labels kinds and picks an Open on X url", () => {
    assert.equal(forYouKindLabel("repost"), "Repost");
    assert.equal(
      forYouOpenUrl({
        ...base,
        kind: "reply",
        draft: "hey",
        targetId: "77",
        targetUrl: "https://x.com/a/status/77",
      }),
      "https://x.com/a/status/77",
    );
    const compose = forYouOpenUrl(base);
    assert.ok(compose?.includes("intent/tweet"));
    assert.ok(compose?.includes("Ship"));
    assert.equal(
      forYouOpenUrl({ ...base, draft: null, targetUrl: null, targetId: null }),
      null,
    );
  });
});
