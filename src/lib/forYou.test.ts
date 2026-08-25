import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROACH_TAB_LABEL,
  approachEmptyCopy,
  firstDigestWeekday,
  forYouComposeSeed,
  forYouKindClass,
  forYouKindLabel,
  forYouKindShort,
  forYouOpenUrl,
  forYouUsesDeskCompose,
  parseForYouProgress,
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

  it("only post and quote cards with a numeric target use the desk compose path", () => {
    assert.equal(forYouUsesDeskCompose(base), true);
    assert.equal(
      forYouUsesDeskCompose({ ...base, kind: "quote", targetId: "10" }),
      true,
    );
    assert.equal(
      forYouUsesDeskCompose({
        ...base,
        kind: "quote",
        targetId: null,
        targetUrl: "https://x.com/a/status/10",
      }),
      false,
    );
    assert.equal(forYouUsesDeskCompose({ ...base, kind: "reply" }), false);
    assert.equal(forYouUsesDeskCompose({ ...base, kind: "repost" }), false);
    assert.equal(forYouComposeSeed(base), "900 views\n\nShip a recap.");
    assert.equal(
      forYouComposeSeed({ ...base, draft: null }),
      "900 views",
    );
  });

  it("labels kinds and picks an Open on X url", () => {
    assert.equal(forYouKindLabel("repost"), "Repost");
    assert.equal(forYouKindShort("post"), "OG");
    assert.equal(forYouKindShort("quote"), "QT");
    assert.equal(forYouKindShort("repost"), "RT");
    assert.equal(forYouKindShort("reply"), "RE");
    assert.equal(forYouKindClass("quote"), "kind-quote");
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

  it("rejects non-http(s) targetUrl schemes and falls back", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:msgbox(1)",
    ]) {
      const url = forYouOpenUrl({ ...base, targetUrl: bad });
      assert.ok(url);
      assert.ok(/^https?:\/\//i.test(url!), `got unsafe url ${url}`);
      assert.ok(!url?.includes(bad));
    }
    assert.ok(
      forYouOpenUrl({ ...base, targetUrl: "HTTPS://x.com/a/status/9" })?.startsWith(
        "HTTPS://",
      ),
    );
    assert.ok(
      forYouOpenUrl({ ...base, targetUrl: "http://x.com/a/status/9" })?.startsWith(
        "http://",
      ),
    );
  });

  it("parses digest progress and names the first-digest weekday", () => {
    assert.equal(APPROACH_TAB_LABEL, "Approach");
    assert.equal(parseForYouProgress({}), null);
    assert.deepEqual(parseForYouProgress({ tracked: 3 }), {
      tracked: 3,
      needed: 5,
    });
    const now = new Date("2026-08-25T12:00:00.000Z");
    assert.equal(firstDigestWeekday(3, 5, now), "Friday");
    assert.equal(firstDigestWeekday(5, 5, now), "the next UTC daily pass");
    assert.match(
      approachEmptyCopy({
        searching: false,
        progress: { tracked: 3, needed: 5 },
        now,
      }),
      /3 of 5 posts tracked — first digest ~Friday/,
    );
    assert.match(
      approachEmptyCopy({
        searching: false,
        progress: { tracked: 5, needed: 5 },
      }),
      /5 of 5 posts tracked — first digest after the next UTC daily pass/,
    );
    assert.equal(approachEmptyCopy({ searching: true }), "Scout is working…");
  });
});
