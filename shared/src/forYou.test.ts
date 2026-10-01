import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  APPROACH_TAB_LABEL,
  parseForYouExtra,
  forYouKindClass,
  forYouKindLabel,
  forYouKindShort,
  forYouOpenUrl,
  parseForYouProgress,
  parseForYouSuggestion,
  FYP_COMPOSE_TIP,
  FYP_INSPIRATION_TIP,
  FYP_NEXT_TIP,
  FYP_OPEN_TIP,
  FYP_WAIT_COPY,
  X_COMPOSE_URL,
  X_INSPIRATION_URL,
  type ForYouSuggestion,
} from "./forYou.ts";

const base: ForYouSuggestion = {
  id: "s1",
  kind: "post",
  why: "900 views",
  targetId: null,
  targetUrl: null,
  targetAuthor: null,
};

await describe("forYou helpers", async () => {
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
    assert.equal(Object.hasOwn(row!, "draft"), false);
  }).catch(assert.fail);

  await it("labels kinds and picks an Open on X url", () => {
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
        targetId: "77",
        targetUrl: "https://x.com/a/status/77",
      }),
      "https://x.com/a/status/77",
    );
  });

  await it("opens post rows on a blank X compose with no prefilled text or target", () => {
    for (const row of [
      base,
      { ...base, targetUrl: "https://x.com/a/status/77", targetId: "77" },
      { ...base, targetId: "77" },
    ]) {
      const url = forYouOpenUrl(row);
      assert.equal(url, X_COMPOSE_URL);
      assert.equal(new URL(url!).search, "");
    }
  });

  it("opens a quote or repost target by status id and never builds a compose from text", () => {
    assert.equal(
      forYouOpenUrl({ ...base, kind: "quote", targetId: "10" }),
      "https://x.com/i/status/10",
    );
    assert.equal(
      forYouOpenUrl({ ...base, kind: "repost", targetId: "11" }),
      "https://x.com/i/status/11",
    );
    assert.equal(forYouOpenUrl({ ...base, kind: "quote" }), null);
    assert.equal(forYouOpenUrl({ ...base, kind: "quote", targetId: "abc" }), null);
  }).catch(assert.fail);

  await it("opens an empty reply intent when only a numeric target id is present", () => {
    const url = new URL(forYouOpenUrl({ ...base, kind: "reply", targetId: "77" })!);
    assert.equal(url.origin + url.pathname, "https://x.com/intent/tweet");
    assert.equal(url.searchParams.get("in_reply_to"), "77");
    assert.equal(url.searchParams.has("text"), false);
  });

  it("rejects non-http(s) targetUrl schemes and falls back", () => {
    for (const bad of [
      "javascript:alert(1)",
      "data:text/html,x",
      "vbscript:msgbox(1)",
    ]) {
      const url = forYouOpenUrl({ ...base, kind: "quote", targetId: "9", targetUrl: bad });
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
    assert.match(FYP_COMPOSE_TIP, /You write it/);
    assert.match(FYP_INSPIRATION_TIP, /Inspiration/);
    assert.match(FYP_NEXT_TIP, /next Approach card/);
    assert.equal(
      X_INSPIRATION_URL,
      "https://x.com/i/jf/creators/inspiration/top_posts",
    );
  }).catch(assert.fail);

  it("keeps the wait short", () => {
    assert.equal(FYP_WAIT_COPY.includes("Like"), false);
    assert.match(FYP_WAIT_COPY, /Open For You or Inspiration/);
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
