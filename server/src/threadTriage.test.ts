import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeTriage,
  parseTriageJson,
  triageThreads,
  MAX_TRIAGE_THREADS,
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

describe("parseTriageJson", () => {
  it("parses a full item", () => {
    const items = parseTriageJson(
      '{"items":[{"id":"1","summary":"Asks for AI tips to farm replies.","baitScore":82,"flags":["engagement_bait","generic_question"],"intent":"engagement farming","engage":"skip","reason":"Generic question, no context."}]}',
    );
    assert.deepEqual(items, [
      {
        id: "1",
        summary: "Asks for AI tips to farm replies.",
        baitScore: 82,
        flags: ["engagement_bait", "generic_question"],
        intent: "engagement farming",
        engage: "skip",
        reason: "Generic question, no context.",
      },
    ]);
  });

  it("strips markdown fences", () => {
    const items = parseTriageJson('```json\n{"items":[{"id":"7"}]}\n```');
    assert.deepEqual(items, [{ id: "7" }]);
  });

  it("clamps and rounds baitScore", () => {
    const items = parseTriageJson(
      '{"items":[{"id":"a","baitScore":140},{"id":"b","baitScore":-20},{"id":"c","baitScore":42.6}]}',
    );
    assert.deepEqual(
      items?.map((i) => i.baitScore),
      [100, 0, 43],
    );
  });

  it("drops invalid engage values but keeps the item", () => {
    const items = parseTriageJson(
      '{"items":[{"id":"1","engage":"maybe","summary":"Ships a CLI."}]}',
    );
    assert.deepEqual(items, [{ id: "1", summary: "Ships a CLI." }]);
  });

  it("normalizes flags and drops empty ones", () => {
    const items = parseTriageJson(
      '{"items":[{"id":"1","flags":["Engagement Bait","promo","promo","",3]}]}',
    );
    assert.deepEqual(items?.[0].flags, ["engagement_bait", "promo"]);
  });

  it("skips items without an id and dedupes repeats", () => {
    const items = parseTriageJson(
      '{"items":[{"summary":"no id"},{"id":"1","baitScore":10},{"id":"1","baitScore":90}]}',
    );
    assert.deepEqual(items, [{ id: "1", baitScore: 10 }]);
  });

  it("returns null for non-json and missing items array", () => {
    assert.equal(parseTriageJson("just text"), null);
    assert.equal(parseTriageJson('{"threads":[]}'), null);
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
          engage: "priority",
        },
      ],
    );
    assert.equal(merged[0].summary, "Genuine question about Vite proxies.");
    assert.equal(merged[0].baitScore, 12);
    assert.equal(merged[0].score, 12);
    assert.equal(merged[0].engage, "priority");
    assert.equal(merged[0].text, "post 1");
    assert.equal(merged[1].summary, undefined);
    assert.equal(merged[1].score, undefined);
  });

  it("ignores unknown ids", () => {
    const merged = mergeTriage(
      [thread("1")],
      [{ id: "999", summary: "not ours", baitScore: 90 }],
    );
    assert.deepEqual(merged, [thread("1")]);
  });
});

describe("triageThreads", () => {
  it("returns threads untouched when there is nothing to triage", async () => {
    const result = await triageThreads({ threads: [], apiKey: "test-key" });
    assert.deepEqual(result.threads, []);
    assert.equal(result.warning, undefined);
  });

  it("degrades softly without an api key", async () => {
    const threads = [thread("1")];
    const result = await triageThreads({ threads, apiKey: "" });
    assert.deepEqual(result.threads, threads);
    assert.match(result.warning ?? "", /DEEPSEEK_API_KEY/);
  });
});

describe("MAX_TRIAGE_THREADS", () => {
  it("caps the batch at 20", () => {
    assert.equal(MAX_TRIAGE_THREADS, 20);
  });
});
