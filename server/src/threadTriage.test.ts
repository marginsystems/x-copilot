import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildTriageCompact,
  buildUserMessage,
  cleanThreadKind,
  formatMemoryBlock,
  gatherTriageMemories,
  isCompleteTriageItem,
  isCoolSkipThreadKind,
  mergeTriage,
  missingTriageIds,
  parseTriageJson,
  selectMemoryHits,
  selectScoredThreads,
  TRIAGE_SYSTEM_PROMPT,
  triageThreads,
  MAX_TRIAGE_THREADS,
  THREAD_KINDS,
} from "./threadTriage.ts";
import type { ThreadCard } from "./xSearch.ts";

function thread(id: string): ThreadCard {
  return {
    id,
    author: "@builder",
    text: `post ${id}`,
    url: `https://x.com/builder/status/${id}`,
  };
}

function completeJson(
  items: Array<{
    id: string;
    summary?: string;
    baitScore?: number;
    flags?: string[];
    intent?: string;
    threadKind?: string;
    engage?: string;
    reason?: string;
  }>,
): string {
  return JSON.stringify({ items });
}

describe("buildTriageCompact", () => {
  it("includes OP context when present", () => {
    const compact = buildTriageCompact([
      {
        id: "1",
        author: "@asker",
        text: "How do you get traffic?",
        url: "https://x.com/asker/status/1",
        isReply: true,
        opAuthor: "@hustler",
        opText: "just crossed $632 revenue 100% profit",
      },
    ]);
    assert.deepEqual(compact[0], {
      id: "1",
      author: "@asker",
      text: "How do you get traffic?",
      isReply: true,
      opAuthor: "@hustler",
      opText: "just crossed $632 revenue 100% profit",
    });
  });

  it("strips media shortlinks and annotates hasNativeMedia", () => {
    const compact = buildTriageCompact([
      {
        id: "2",
        author: "@TheAionikAge",
        text: "KYA frameworks question https://t.co/f2WC3JoDhC",
        url: "https://x.com/TheAionikAge/status/2",
        mediaShortlinks: ["t.co/f2wc3jodhc"],
      },
    ]);
    assert.deepEqual(compact[0], {
      id: "2",
      author: "@TheAionikAge",
      text: "KYA frameworks question",
      hasNativeMedia: true,
    });
  });
});

describe("TRIAGE_SYSTEM_PROMPT media annotation", () => {
  it("tells the model not to treat hasNativeMedia as an outbound link", () => {
    assert.match(TRIAGE_SYSTEM_PROMPT, /hasNativeMedia/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /Do NOT treat that as an outbound link/);
  });
});

describe("isCompleteTriageItem", () => {
  it("requires id, summary, baitScore, and threadKind", () => {
    assert.equal(
      isCompleteTriageItem({
        id: "1",
        summary: "Ok",
        baitScore: 10,
        threadKind: "other",
      }),
      true,
    );
    assert.equal(isCompleteTriageItem({ id: "1", summary: "Ok" }), false);
    assert.equal(isCompleteTriageItem({ id: "1", baitScore: 10 }), false);
    assert.equal(
      isCompleteTriageItem({ id: "1", summary: "   ", baitScore: 10 }),
      false,
    );
    assert.equal(
      isCompleteTriageItem({ id: "1", summary: "Ok", baitScore: 10 }),
      false,
    );
  });
});

describe("parseTriageJson", () => {
  it("parses a full item", () => {
    const items = parseTriageJson(
      completeJson([
        {
          id: "1",
          summary: "Asks for AI tips to farm replies.",
          baitScore: 82,
          threadKind: "hollow_ask",
          flags: ["engagement_bait", "generic_question"],
          intent: "engagement farming",
          engage: "skip",
          reason: "Generic question, no context.",
        },
      ]),
    );
    assert.deepEqual(items, [
      {
        id: "1",
        summary: "Asks for AI tips to farm replies.",
        baitScore: 82,
        threadKind: "hollow_ask",
        flags: ["engagement_bait", "generic_question"],
        intent: "engagement farming",
        engage: "skip",
        reason: "Generic question, no context.",
      },
    ]);
  });

  it("normalizes threadKind and drops items with unknown kinds", () => {
    const items = parseTriageJson(
      completeJson([
        {
          id: "1",
          summary: "News plus take.",
          baitScore: 20,
          threadKind: "Timely Take",
        },
        {
          id: "2",
          summary: "Unknown kind dropped with the item.",
          baitScore: 20,
          threadKind: "not_a_real_kind",
        },
      ]),
    );
    assert.equal(items?.length, 1);
    assert.equal(items?.[0]?.id, "1");
    assert.equal(items?.[0]?.threadKind, "timely_take");
  });

  it("strips markdown fences for complete items", () => {
    const items = parseTriageJson(
      '```json\n{"items":[{"id":"7","summary":"Short take.","baitScore":20,"threadKind":"sharp_opinion"}]}\n```',
    );
    assert.deepEqual(items, [
      {
        id: "7",
        summary: "Short take.",
        baitScore: 20,
        threadKind: "sharp_opinion",
      },
    ]);
  });

  it("rejects incomplete items without baitScore, summary, or threadKind", () => {
    const items = parseTriageJson(
      completeJson([
        { id: "1", engage: "skip", summary: "Has summary only" },
        { id: "2", baitScore: 50 },
        { id: "4", summary: "No kind.", baitScore: 30 },
        { id: "3", summary: "Complete.", baitScore: 40, threadKind: "fact_add" },
      ]),
    );
    assert.deepEqual(items, [
      { id: "3", summary: "Complete.", baitScore: 40, threadKind: "fact_add" },
    ]);
  });

  it("clamps and rounds baitScore", () => {
    const items = parseTriageJson(
      completeJson([
        { id: "a", summary: "A", baitScore: 140, threadKind: "other" },
        { id: "b", summary: "B", baitScore: -20, threadKind: "other" },
        { id: "c", summary: "C", baitScore: 42.6, threadKind: "other" },
      ]),
    );
    assert.deepEqual(
      items?.map((i) => i.baitScore),
      [100, 0, 43],
    );
  });

  it("drops invalid engage values but keeps complete items", () => {
    const items = parseTriageJson(
      completeJson([
        {
          id: "1",
          engage: "maybe",
          summary: "Ships a CLI.",
          baitScore: 15,
          threadKind: "other",
        },
      ]),
    );
    assert.deepEqual(items, [
      { id: "1", summary: "Ships a CLI.", baitScore: 15, threadKind: "other" },
    ]);
  });

  it("normalizes flags and drops empty ones", () => {
    const items = parseTriageJson(
      '{"items":[{"id":"1","summary":"Promo.","baitScore":70,"threadKind":"promo_context","flags":["Engagement Bait","promo","promo","",3]}]}',
    );
    assert.deepEqual(items?.[0].flags, ["engagement_bait", "promo"]);
  });

  it("skips items without an id and dedupes repeats", () => {
    const items = parseTriageJson(
      '{"items":[{"summary":"no id","baitScore":1},{"id":"1","summary":"First","baitScore":10,"threadKind":"other"},{"id":"1","summary":"Second","baitScore":90,"threadKind":"other"}]}',
    );
    assert.deepEqual(items, [
      { id: "1", summary: "First", baitScore: 10, threadKind: "other" },
    ]);
  });

  it("handles {} characters inside string values", () => {
    const json =
      '{"items":[{"id":"1","summary":"Shows code: { x = 1 }","baitScore":25,"threadKind":"other","reason":"Contains } brace"}]}';
    const items = parseTriageJson(json);
    assert.deepEqual(items, [
      {
        id: "1",
        summary: "Shows code: { x = 1 }",
        baitScore: 25,
        threadKind: "other",
        reason: "Contains } brace",
      },
    ]);
  });

  it("ignores incomplete items when extra text surrounds JSON", () => {
    const json =
      'Some prefix {"items":[{"id":"1","summary":"Ok.","baitScore":11,"threadKind":"other"}]} trailing';
    const items = parseTriageJson(json);
    assert.deepEqual(items, [
      { id: "1", summary: "Ok.", baitScore: 11, threadKind: "other" },
    ]);
  });

  it("returns null for non-json and missing items array", () => {
    assert.equal(parseTriageJson("just text"), null);
    assert.equal(parseTriageJson('{"threads":[]}'), null);
  });
});

describe("missingTriageIds", () => {
  it("returns batch ids without a complete item", () => {
    assert.deepEqual(
      missingTriageIds(
        ["1", "2", "3"],
        [
          {
            id: "2",
            summary: "Ok",
            baitScore: 10,
            threadKind: "lived_answer",
          },
        ],
      ),
      ["1", "3"],
    );
  });
});

describe("selectScoredThreads", () => {
  it("keeps only threads with a numeric baitScore", () => {
    const scored = selectScoredThreads([
      { ...thread("1"), baitScore: 12 },
      thread("2"),
      { ...thread("3"), score: 40 },
    ]);
    assert.deepEqual(
      scored.map((t) => t.id),
      ["1"],
    );
  });
});

describe("threadKind helpers", () => {
  it("accepts the closed enum and rejects junk", () => {
    assert.equal(cleanThreadKind("lived_answer"), "lived_answer");
    assert.equal(cleanThreadKind(" Bare News "), "bare_news");
    assert.equal(cleanThreadKind("nope"), undefined);
    assert.equal(THREAD_KINDS.includes("other"), true);
  });

  it("flags cool-skip kinds", () => {
    assert.equal(isCoolSkipThreadKind("hollow_ask"), true);
    assert.equal(isCoolSkipThreadKind("promo_context"), true);
    assert.equal(isCoolSkipThreadKind("bare_news"), true);
    assert.equal(isCoolSkipThreadKind("closed_thread"), true);
    assert.equal(isCoolSkipThreadKind("timely_take"), false);
    assert.equal(isCoolSkipThreadKind(undefined), false);
  });

  it("documents prefer/skip kinds in the system prompt", () => {
    assert.match(TRIAGE_SYSTEM_PROMPT, /threadKind/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /timely_take/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /hollow_ask/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /GitHub Actions outage/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /shipping this week/);
  });
});

describe("mergeTriage", () => {
  it("merges by id and mirrors baitScore onto score", () => {
    const merged = mergeTriage(
      [thread("1"), thread("2")],
      [
        {
          id: "1",
          summary: "Genuine question about Vite proxies.",
          baitScore: 12,
          threadKind: "lived_answer",
          engage: "priority",
        },
      ],
    );
    assert.equal(merged[0].summary, "Genuine question about Vite proxies.");
    assert.equal(merged[0].baitScore, 12);
    assert.equal(merged[0].score, 12);
    assert.equal(merged[0].engage, "priority");
    assert.equal(merged[0].threadKind, "lived_answer");
    assert.equal(merged[0].text, "post 1");
    assert.equal(merged[1].summary, undefined);
    assert.equal(merged[1].score, undefined);
  });

  it("ignores unknown ids", () => {
    const merged = mergeTriage(
      [thread("1")],
      [
        {
          id: "999",
          summary: "not ours",
          baitScore: 90,
          threadKind: "other",
        },
      ],
    );
    assert.deepEqual(merged, [thread("1")]);
  });
});

describe("memory triage context", () => {
  it("selectMemoryHits prefers 2 interactions + 2 dismissals", () => {
    const hits = selectMemoryHits([
      { path: "a", type: "interaction", score: 0.9, excerpt: "ship AI" },
      { path: "b", type: "interaction", score: 0.8, excerpt: "builders" },
      { path: "c", type: "interaction", score: 0.7, excerpt: "extra" },
      { path: "d", type: "dismissal", score: 0.95, excerpt: "bait" },
      { path: "e", type: "dismissal", score: 0.5, excerpt: "promo" },
      { path: "f", type: "dismissal", score: 0.4, excerpt: "skip" },
    ]);
    assert.equal(hits.length, 4);
    assert.equal(hits.filter((h) => h.type === "interaction").length, 2);
    assert.equal(hits.filter((h) => h.type === "dismissal").length, 2);
    assert.ok(hits.every((h) => h.excerpt !== "extra" && h.excerpt !== "skip"));
  });

  it("formatMemoryBlock / buildUserMessage include stubs when hits exist", () => {
    const block = formatMemoryBlock([
      { type: "dismissal", score: 0.88, excerpt: "Generic favorite-tool bait" },
      { type: "interaction", score: 0.71, excerpt: "Shipping AI in public tip" },
    ]);
    assert.match(block, /Memory \(advisory/);
    assert.match(block, /\[dismissal/);
    assert.match(block, /\[interaction/);

    const msg = buildUserMessage("Find builders", [thread("1")], [
      { type: "dismissal", score: 0.88, excerpt: "Generic favorite-tool bait" },
    ]);
    assert.match(msg, /Memory \(advisory/);
    assert.match(msg, /Generic favorite-tool bait/);
    assert.match(msg, /Posts:/);
  });

  it("buildUserMessage omits Memory when search is empty", () => {
    const msg = buildUserMessage("Find builders", [thread("1")], []);
    assert.doesNotMatch(msg, /Memory \(advisory/);
  });

  it("gatherTriageMemories soft-fails to [] when search returns empty", async () => {
    const hits = await gatherTriageMemories([thread("1")], async () => ({
      hits: [],
    }));
    assert.deepEqual(hits, []);
  });

  it("gatherTriageMemories spreads the batch query across all cards", async () => {
    const batch = Array.from({ length: 20 }, (_, i) => ({
      ...thread(String(i)),
      text: `${i}: ${"B".repeat(500)}`,
    }));
    let query = "";
    const hits = await gatherTriageMemories(batch, async (opts) => {
      query = opts.query;
      return { hits: [] };
    });
    assert.equal(hits.length, 0);
    assert.ok(
      query.includes("19:"),
      "later cards should contribute to the batch query",
    );
  });
});

describe("triageThreads", () => {
  it("returns threads untouched when there is nothing to triage", async () => {
    const result = await triageThreads({ threads: [], apiKey: "test-key" });
    assert.deepEqual(result.threads, []);
    assert.equal(result.warning, undefined);
  });

  it("returns empty list without an api key (no unscored fallback)", async () => {
    const threads = [thread("1")];
    const result = await triageThreads({
      threads,
      apiKey: "",
      searchMemory: async () => {
        throw new Error("should not run without api key");
      },
    });
    assert.deepEqual(result.threads, []);
    assert.match(result.warning ?? "", /DEEPSEEK_API_KEY/);
  });
});

describe("MAX_TRIAGE_THREADS", () => {
  it("caps the batch at 20", () => {
    assert.equal(MAX_TRIAGE_THREADS, 20);
  });
});

describe("TRIAGE_SYSTEM_PROMPT", () => {
  it("includes political in the flags vocabulary", () => {
    assert.match(TRIAGE_SYSTEM_PROMPT, /genuine_question, political/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /flag political/);
  });

  it("hard-skips pure event promos without suppressing substantive posts", () => {
    assert.match(TRIAGE_SYSTEM_PROMPT, /register, RSVP, tune in, or join/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /flag event_promo/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /does not become event_promo/);
    assert.match(TRIAGE_SYSTEM_PROMPT, /Post-event recaps are not automatically skipped/);
  });

  it("treats high outcomes as stronger positive evidence and low as weak not negative", () => {
    assert.match(TRIAGE_SYSTEM_PROMPT, /Mature 24h outcomes are stronger/);
    assert.match(
      TRIAGE_SYSTEM_PROMPT,
      /High views\/likes on a past interaction strengthen/,
    );
    assert.match(
      TRIAGE_SYSTEM_PROMPT,
      /Low or missing stats only weaken confidence/,
    );
    assert.match(TRIAGE_SYSTEM_PROMPT, /they are never negative evidence/);
    assert.match(
      TRIAGE_SYSTEM_PROMPT,
      /Do not treat raw view\/like counts as normalized/,
    );
    assert.match(
      TRIAGE_SYSTEM_PROMPT,
      /Outcomes do not override bait, promo, safety/,
    );
  });
});
