import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROACH_TAB_LABEL,
  parseForYouExtra,
  forYouComposeSeed,
  forYouKindClass,
  forYouKindLabel,
  forYouKindShort,
  forYouOpenUrl,
  forYouUsesDeskCompose,
  parseForYouProgress,
  parseForYouSuggestion,
  FYP_ACTION_COPY,
  FYP_INSPIRATION_TIP,
  FYP_NEXT_TIP,
  FYP_OPEN_TIP,
  FYP_WAIT_COPY,
  X_FOR_YOU_URL,
  X_INSPIRATION_URL,
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
  }).catch(assert.fail);

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
  }).catch(assert.fail);

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
  });

  it("opens post rows on For You without the digest draft or target", () => {
    for (const row of [
      base,
      { ...base, draft: null },
      { ...base, targetUrl: "https://x.com/a/status/77", targetId: "77" },
      { ...base, targetId: "77" },
    ]) {
      const url = forYouOpenUrl(row);
      assert.equal(url, X_FOR_YOU_URL);
      assert.ok(!decodeURIComponent(url!).includes(base.draft!));
    }
  });

  it("keeps the draft fallback for a quote without a target", () => {
    const compose = forYouOpenUrl({ ...base, kind: "quote" });
    assert.ok(compose?.includes("intent/tweet"));
    assert.ok(compose?.includes("Ship"));
    assert.equal(
      forYouOpenUrl({ ...base, kind: "quote", draft: null }),
      null,
    );
  }).catch(assert.fail);

  it("opens a reply intent with the draft when only a numeric target id is present", () => {
    const url = new URL(forYouOpenUrl({ ...base, kind: "reply", targetId: "77" })!);
    assert.equal(url.origin + url.pathname, "https://x.com/intent/tweet");
    assert.equal(url.searchParams.get("in_reply_to"), "77");
    assert.equal(url.searchParams.get("text"), base.draft);
  });

  it("rejects non-http(s) targetUrl schemes and falls back", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:msgbox(1)",
    ]) {
      const url = forYouOpenUrl({ ...base, kind: "quote", targetUrl: bad });
      assert.ok(url);
      assert.ok(/^https?:\/\//i.test(url!), `got unsafe url ${url}`);
      assert.ok(!url?.includes(bad));
    }
    assert.equal(
      forYouOpenUrl({ ...base, kind: "quote", targetUrl: "HTTPS://x.com/a/status/9" }),
      "HTTPS://x.com/a/status/9",
    );
    assert.equal(
      forYouOpenUrl({ ...base, kind: "quote", targetUrl: "http://x.com/a/status/9" }),
      "http://x.com/a/status/9",
    );
  }).catch(assert.fail);

  it("parses digest progress", () => {
    assert.equal(APPROACH_TAB_LABEL, "Approach");
    assert.equal(parseForYouProgress({}), null);
    assert.deepEqual(parseForYouProgress({ tracked: 3 }), {
      tracked: 3,
      needed: 5,
    });
  }).catch(assert.fail);

  it("names the For You row buttons", () => {
    assert.match(FYP_OPEN_TIP, /For You page/);
    assert.match(FYP_INSPIRATION_TIP, /Inspiration/);
    assert.match(FYP_NEXT_TIP, /next Approach card/);
    assert.equal(
      X_INSPIRATION_URL,
      "https://x.com/i/jf/creators/inspiration/top_posts",
    );
  }).catch(assert.fail);

  it("keeps the collapsed wait short and names the expanded action", () => {
    assert.equal(FYP_WAIT_COPY.includes("Like"), false);
    assert.match(FYP_WAIT_COPY, /Open For You or Inspiration/);
    assert.match(FYP_ACTION_COPY, /Reply, original, or quote/);
    assert.match(FYP_ACTION_COPY, /For You or Inspiration/);
    assert.match(FYP_ACTION_COPY, /Likes do not count/);
  }).catch(assert.fail);

  it("parses extra usage from GET /api/for-you", () => {
    assert.equal(parseForYouExtra(null), null);
    assert.equal(parseForYouExtra({ extra: { cost: 15 } }), null);
    const extra = parseForYouExtra({
      extra: {
        cost: 15,
        batchSize: 3,
        used: 1,
        limit: 10,
        remaining: 9,
        creditsRemaining: 80,
        canExtra: true,
      },
    });
    assert.deepEqual(extra, {
      cost: 15,
      batchSize: 3,
      used: 1,
      limit: 10,
      remaining: 9,
      creditsRemaining: 80,
      canExtra: true,
    });
  }).catch(assert.fail);
});
