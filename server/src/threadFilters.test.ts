import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXCLUDED_TAGS,
  DEFAULT_MAX_THREAD_CHARS,
  EM_DASH,
  filterAutomatedAccounts,
  filterByLanguage,
  filterEmDashes,
  filterOutboundLinks,
  filterSelfReplies,
  filterThreadsByLength,
  isNonPreferredLanguage,
  languageSampleText,
  isOversizedThread,
  isSelfReply,
  isThreadOpener,
  normalizeExcludedTags,
  normalizePreferredLanguageCode,
  normalizeTagToken,
  resolveExcludedTags,
  resolveMaxThreadChars,
  resolveMaxThreadCharsFromFilters,
  collectBaitConversationIds,
  isBaitConversationTagged,
  replyUnderBaitConversation,
  textHasEmDash,
  threadHasExcludedTag,
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

  it("detects same-author via hydrated opAuthor without inReplyToScreenName", () => {
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@Kalani_Maluai",
        text: "summary of my prior post",
        url: "https://x.com/Kalani_Maluai/status/1",
        inReplyToId: "0",
        isReply: true,
        opAuthor: "@Kalani_Maluai",
        opText: "root of my own thread",
        opParentDerived: true,
      }),
      true,
    );
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@Kalani_Maluai",
        text: "summary of my prior post",
        url: "https://x.com/Kalani_Maluai/status/1",
        inReplyToId: "0",
        isReply: true,
        opAuthor: "Kalani_Maluai",
        opParentDerived: true,
      }),
      true,
    );
  });

  it("keeps cross-account replies when only opAuthor is set", () => {
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@alice",
        text: "agree",
        url: "https://x.com/alice/status/1",
        inReplyToId: "0",
        isReply: true,
        opAuthor: "@bob",
        opText: "root from bob",
        opParentDerived: true,
      }),
      false,
    );
  });

  it("keeps quote-derived opAuthor equal to author", () => {
    assert.equal(
      isSelfReply({
        id: "1",
        author: "@alice",
        text: "agree",
        url: "https://x.com/alice/status/1",
        inReplyToId: "0",
        inReplyToScreenName: "@bob",
        isReply: true,
        opAuthor: "@alice",
        opText: "my own earlier post",
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

describe("filterByLanguage", () => {
  const spanish =
    "Ahora que todos están quejándose de build in public, voy yo: dejé de hacer build in public porque me copiaban todo, literalmente todo, hasta las publicaciones sobre qué roles contratábamos.";
  const english =
    "Just shipped a tiny AI tool in public. Looking for builders with genuine questions about distribution and shipping loops.";
  const french =
    "Ton article est full value ! On s'entête parfois dans le build in public, post etc alors qu'un commentaire sous un post viral peut te faire plus facilement avancer.";

  it("drops Spanish for preferred en; keeps English BIP", () => {
    const es = thread("es1", spanish, undefined, { author: "@ssebita_r" });
    const en = thread("en1", english);
    const result = filterByLanguage([es, en], "en");
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["en1"],
    );
    assert.equal(result.languageFilteredCount, 1);
    assert.equal(isNonPreferredLanguage(es, "en"), true);
    assert.equal(isNonPreferredLanguage(en, "en"), false);
  });

  it("keeps short ambiguous text", () => {
    const short = thread("s1", "ok thanks");
    assert.equal(isNonPreferredLanguage(short, "en"), false);
    const result = filterByLanguage([short], "en");
    assert.equal(result.languageFilteredCount, 0);
    assert.equal(result.threads.length, 1);
  });

  it("samples only the card's own text, ignoring OP/root text", () => {
    const englishReply = thread("en1", english, undefined, {
      opText: spanish,
    });
    assert.equal(languageSampleText(englishReply), english);
    assert.equal(isNonPreferredLanguage(englishReply, "en"), false);
    const result = filterByLanguage([englishReply], "en");
    assert.equal(result.languageFilteredCount, 0);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["en1"],
    );
  });

  it("keeps French when preferred is fr", () => {
    const fr = thread("fr1", french);
    const en = thread("en1", english);
    const result = filterByLanguage([fr, en], "fr");
    assert.ok(result.threads.some((t) => t.id === "fr1"));
    assert.ok(!result.threads.some((t) => t.id === "en1"));
  });

  it("normalizePreferredLanguageCode defaults invalid to en", () => {
    assert.equal(normalizePreferredLanguageCode("de"), "de");
    assert.equal(normalizePreferredLanguageCode("zz"), "en");
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
    assert.equal(threadHasOutboundLink(thread("2", "see t.co/abc123")), false);
    assert.equal(threadHasOutboundLink(thread("3", "no links here")), false);
  });
});

describe("filterEmDashes", () => {
  it("detects U+2014 only (not hyphen or en dash)", () => {
    assert.equal(textHasEmDash(`Not a benchmark ${EM_DASH} infrastructure`), true);
    assert.equal(textHasEmDash("plain hyphen - ok"), false);
    assert.equal(textHasEmDash("en dash \u2013 ok"), false);
  });

  it("drops em-dash posts by default and keeps clean ones", () => {
    const slop = thread("1", `Not a benchmark ${EM_DASH} infrastructure`);
    const clean = thread("2", "Ship weekly. Concrete take.");
    const result = filterEmDashes([slop, clean]);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2"],
    );
    assert.equal(result.emDashFilteredCount, 1);
  });

  it("keeps em-dash posts when dropEmDashes is false", () => {
    const slop = thread("1", `Hello ${EM_DASH} world`);
    const result = filterEmDashes([slop], { dropEmDashes: false });
    assert.equal(result.threads.length, 1);
    assert.equal(result.emDashFilteredCount, 0);
  });
});

describe("filterAutomatedAccounts", () => {
  it("drops isAutomated authors by default and keeps humans", () => {
    const bot: ThreadCard = {
      ...thread("1", "AI take"),
      isAutomated: true,
    };
    const human = thread("2", "Human take");
    const result = filterAutomatedAccounts([bot, human]);
    assert.deepEqual(
      result.threads.map((t) => t.id),
      ["2"],
    );
    assert.equal(result.automatedFilteredCount, 1);
  });

  it("keeps automated authors when dropAutomatedAccounts is false", () => {
    const bot: ThreadCard = {
      ...thread("1", "AI take"),
      isAutomated: true,
    };
    const result = filterAutomatedAccounts([bot], {
      dropAutomatedAccounts: false,
    });
    assert.equal(result.threads.length, 1);
    assert.equal(result.automatedFilteredCount, 0);
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

describe("excluded triage tags", () => {
  it("normalizes intent-like phrases to snake_case tokens", () => {
    assert.equal(
      normalizeTagToken("Supportive Encouragement"),
      "supportive_encouragement",
    );
    assert.equal(normalizeTagToken(" genuine-question "), "genuine_question");
    assert.equal(normalizeTagToken(""), null);
    assert.equal(normalizeTagToken("!!!"), null);
  });

  it("defaults missing exclude lists and preserves explicit empty", () => {
    assert.deepEqual(normalizeExcludedTags(undefined), [...DEFAULT_EXCLUDED_TAGS]);
    assert.deepEqual(resolveExcludedTags(undefined), [...DEFAULT_EXCLUDED_TAGS]);
    assert.deepEqual(resolveExcludedTags([]), []);
    assert.deepEqual(
      normalizeExcludedTags(["Supportive Encouragement", "supportive_encouragement", "promo"]),
      ["supportive_encouragement", "promo"],
    );
  });

  it("matches normalized intent and flags exactly", () => {
    assert.equal(
      threadHasExcludedTag(
        { intent: "supportive encouragement", flags: ["genuine_question"] },
        ["supportive_encouragement"],
      ),
      true,
    );
    assert.equal(
      threadHasExcludedTag(
        { intent: "genuine help request", flags: ["supportive_encouragement"] },
        ["supportive_encouragement"],
      ),
      true,
    );
    assert.equal(
      threadHasExcludedTag(
        { intent: "genuine help request", flags: ["genuine_question"] },
        ["supportive_encouragement"],
      ),
      false,
    );
    assert.equal(
      threadHasExcludedTag(
        { intent: "supportive encouragement", flags: [] },
        [],
      ),
      false,
    );
  });
});

describe("bait conversation suppress", () => {
  it("tags high baitScore and bait flags", () => {
    assert.equal(isBaitConversationTagged({ baitScore: 70 }), true);
    assert.equal(isBaitConversationTagged({ baitScore: 69 }), false);
    assert.equal(
      isBaitConversationTagged({
        baitScore: 10,
        flags: ["promo_op", "on_agenda"],
      }),
      true,
    );
    assert.equal(
      isBaitConversationTagged({
        baitScore: 10,
        flags: ["genuine_question"],
      }),
      false,
    );
  });

  it("collects conversation + card ids from bait-tagged rows", () => {
    const ids = collectBaitConversationIds([
      {
        id: "root1",
        conversationId: "root1",
        baitScore: 90,
        flags: ["engagement_bait"],
      },
      {
        id: "reply2",
        conversationId: "root1",
        baitScore: 15,
        flags: ["on_agenda"],
      },
      { id: "other", baitScore: 20 },
    ]);
    assert.equal(ids.has("root1"), true);
    assert.equal(ids.has("reply2"), false);
    assert.equal(ids.has("other"), false);
  });

  it("drops replies under bait roots, keeps roots and unrelated", () => {
    const baitIds = new Set(["bait-root"]);
    assert.equal(
      replyUnderBaitConversation(
        {
          id: "r1",
          isReply: true,
          conversationId: "bait-root",
          inReplyToId: "bait-root",
        },
        baitIds,
      ),
      true,
    );
    assert.equal(
      replyUnderBaitConversation(
        {
          id: "r2",
          isReply: true,
          conversationId: "bait-root",
          inReplyToId: "mid",
        },
        baitIds,
      ),
      true,
    );
    assert.equal(
      replyUnderBaitConversation(
        { id: "bait-root", conversationId: "bait-root" },
        baitIds,
      ),
      false,
    );
    assert.equal(
      replyUnderBaitConversation(
        {
          id: "ok",
          isReply: true,
          conversationId: "clean",
          inReplyToId: "clean",
        },
        baitIds,
      ),
      false,
    );
  });
});
