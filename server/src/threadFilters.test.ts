import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_THREAD_CHARS,
  filterOutboundLinks,
  filterSelfReplies,
  filterThreadsByLength,
  isOversizedThread,
  isSelfReply,
  isThreadOpener,
  resolveMaxThreadChars,
  resolveMaxThreadCharsFromFilters,
  threadHasOutboundLink,
} from "./threadFilters.ts";
import type { ThreadCard } from "./xSearch.ts";

function thread(
  id: string,
  text: string,
  longform?: ThreadCard["longform"],
  extra?: Partial<ThreadCard>,
): ThreadCard {
  return {
    id,
    author: "@a",
    text,
    url: `https://x.com/a/status/${id}`,
    ...(longform ? { longform } : {}),
    ...extra,
  };
}

describe("isSelfReply / filterSelfReplies", () => {
  it("detects same-author reply-to", () => {
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@itsjackdev",
        text: "5/ next",
        url: "https://x.com/itsjackdev/status/1",
        inReplyToId: "0",
        inReplyToScreenName: "@itsjackdev",
      }),
      true,
    );
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@itsjackdev",
        text: "5/ next",
        url: "https://x.com/itsjackdev/status/1",
        inReplyToId: "0",
        inReplyToScreenName: "itsjackdev",
      }),
      true,
    );
  });

  it("keeps cross-account replies and roots", () => {
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@alice",
        text: "agree",
        url: "https://x.com/alice/status/1",
        inReplyToId: "0",
        inReplyToScreenName: "@bob",
      }),
      false,
    );
    assert.equal(
      isSelfReply({
        id: "2",
        author: "@alice",
        text: "root post",
        url: "https://x.com/alice/status/2",
      }),
      false,
    );
  });

  it("filters self-replies from a batch", () => {
    const selfR: ThreadCard = {
      id: "1",
      author: "@a",
      text: "mid",
      url: "https://x.com/a/status/1",
      inReplyToScreenName: "@a",
    };
    const cross: ThreadCard = {
      id: "2",
      author: "@a",
      text: "to b",
      url: "https://x.com/a/status/2",
      inReplyToScreenName: "@b",
    };
    const root = thread("3", "root");
    const result = filterSelfReplies([selfR, cross, root]);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2", "3"],
    );
    assert.equal(result.selfReplyFilteredCount, 1);
  });
});

describe("resolveMaxThreadChars", () => {
  it("defaults when empty or invalid", () => {
    assert.equal(resolveMaxThreadChars(), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars(""), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("abc"), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("0"), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("-10"), DEFAULT_MAX_THREAD_CHARS);
    assert.equal(resolveMaxThreadChars("12.5"), DEFAULT_MAX_THREAD_CHARS);
  });

  it("accepts a positive integer override", () => {
    assert.equal(resolveMaxThreadChars("320"), 320);
    assert.equal(resolveMaxThreadChars(" 900 "), 900);
  });
});

describe("isOversizedThread", () => {
  it("keeps exact max and drops max+1", () => {
    const max = 480;
    assert.equal(isOversizedThread("a".repeat(max), max), false);
    assert.equal(isOversizedThread("a".repeat(max + 1), max), true);
  });
});

describe("isThreadOpener", () => {
  it("matches N/M openers that mention thread", () => {
    assert.equal(isThreadOpener("1/12 Starting a thread about AI"), true);
    assert.equal(isThreadOpener("  3 / 7  A thread about AI"), true);
    assert.equal(isThreadOpener("Here's a short take on AI tools"), false);
  });

  it("rejects N/M-like patterns without thread keyword", () => {
    assert.equal(isThreadOpener("2020/2021 in review — my top AI reads"), false);
    assert.equal(isThreadOpener("1/2 cup coffee then 1/2 coding"), false);
    assert.equal(isThreadOpener("42/42 test suite is green"), false);
  });
});

describe("filterOutboundLinks", () => {
  it("drops flagged cards and text-URL cards; keeps clean", () => {
    const flagged = thread("1", "no url in text", undefined, {
      hasOutboundLink: true,
    });
    const textUrl = thread("2", "Check https://example.com/x");
    const clean = thread("3", "Concrete take: ship weekly.");
    const mention = thread("4", "Thanks @alice for the tip");
    const result = filterOutboundLinks([flagged, textUrl, clean, mention]);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["3", "4"],
    );
    assert.equal(result.linkFilteredCount, 2);
  });

  it("threadHasOutboundLink uses flag or text fallback", () => {
    assert.equal(
      threadHasOutboundLink(thread("1", "hi", undefined, { hasOutboundLink: true })),
      true,
    );
    assert.equal(threadHasOutboundLink(thread("2", "see t.co/abc123")), true);
    assert.equal(threadHasOutboundLink(thread("3", "no links here")), false);
  });
});

describe("filterThreadsByLength", () => {
  it("keeps 480-char posts and drops 481", () => {
    const ok = thread("1", "x".repeat(480));
    const long = thread("2", "y".repeat(481));
    const result = filterThreadsByLength([ok, long], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["1"],
    );
    assert.equal(result.filteredCount, 1);
    assert.equal(result.openerFilteredCount, 0);
    assert.equal(result.articleFilteredCount, 0);
  });

  it("drops thread openers even under the char cap", () => {
    const opener = thread("1", "1/12 Starting a thread about shipping");
    const short = thread("2", "Concrete take: ship weekly.");
    const result = filterThreadsByLength([opener, short], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2"],
    );
    assert.equal(result.filteredCount, 1);
    assert.equal(result.openerFilteredCount, 1);
    assert.equal(result.articleFilteredCount, 0);
  });

  it("hard-drops Articles even when the teaser is under the char cap", () => {
    const article = thread("1", "Short article teaser", "article");
    const short = thread("2", "Concrete take: ship weekly.");
    const result = filterThreadsByLength([article, short], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2"],
    );
    assert.equal(result.filteredCount, 1);
    assert.equal(result.articleFilteredCount, 1);
    assert.equal(result.openerFilteredCount, 0);
  });

  it("drops long note_tweet body via char cap without article flag", () => {
    const longNote = thread("1", "y".repeat(481), "note_tweet");
    const short = thread("2", "Punchy take.");
    const result = filterThreadsByLength([longNote, short], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2"],
    );
    assert.equal(result.filteredCount, 1);
    assert.equal(result.articleFilteredCount, 0);
    assert.equal(result.openerFilteredCount, 0);
  });

  it("keeps punchy note tweets under the cap", () => {
    const note = thread("1", "Shipped v2 — AMA", "note_tweet");
    const result = filterThreadsByLength([note], 480);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["1"],
    );
    assert.equal(result.filteredCount, 0);
  });

  it("keeps short Articles when dropArticles is false", () => {
    const article = thread("1", "Short article teaser", "article");
    const result = filterThreadsByLength([article], 480, {
      dropArticles: false,
    });
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["1"],
    );
    assert.equal(result.articleFilteredCount, 0);
  });

  it("still drops oversized Articles when dropArticles is false", () => {
    const article = thread("1", "y".repeat(481), "article");
    const result = filterThreadsByLength([article], 480, {
      dropArticles: false,
    });
    assert.equal(result.filteredCount, 1);
    assert.equal(result.articleFilteredCount, 0);
  });
});

describe("resolveMaxThreadCharsFromFilters", () => {
  it("prefers positive integer override over env", () => {
    assert.equal(resolveMaxThreadCharsFromFilters(320, "900"), 320);
    assert.equal(resolveMaxThreadCharsFromFilters(undefined, "900"), 900);
    assert.equal(resolveMaxThreadCharsFromFilters(-1, "900"), 900);
    assert.equal(resolveMaxThreadCharsFromFilters(12.5, ""), 480);
  });
});
