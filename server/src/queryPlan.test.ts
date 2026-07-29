import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPhraseyPlan,
  isPhraseyQuery,
  parseQueryPlanJson,
  queryWordCount,
  validateQueries,
} from "./queryPlan.ts";
import { resolveFlashModel, DEEPSEEK_FLASH_MODEL } from "./deepseek.ts";

describe("parseQueryPlanJson", () => {
  it("parses raw JSON", () => {
    const q = parseQueryPlanJson(
      '{"queries":["AI tools","building in public","filter:replies AI"]}',
    );
    assert.deepEqual(q, [
      "AI tools",
      "building in public",
      "filter:replies AI",
    ]);
  });

  it("strips markdown fences", () => {
    const q = parseQueryPlanJson(
      '```json\n{"queries":["one","two"]}\n```',
    );
    assert.deepEqual(q, ["one", "two"]);
  });

  it("rejects fewer than 2 queries", () => {
    assert.equal(parseQueryPlanJson('{"queries":["only"]}'), null);
  });

  it("rejects non-json", () => {
    assert.equal(parseQueryPlanJson("just text"), null);
  });
});

describe("validateQueries", () => {
  it("dedupes and caps at 4", () => {
    const q = validateQueries(["a", "a", "b", "c", "d", "e"]);
    assert.deepEqual(q, ["a", "b", "c", "d"]);
  });
});

describe("queryWordCount / isPhraseyQuery / isPhraseyPlan", () => {
  it("counts whitespace tokens", () => {
    assert.equal(queryWordCount("building in public AI"), 4);
    assert.equal(queryWordCount("  shipped my AI  "), 3);
    assert.equal(queryWordCount("shipping AI tool in public"), 5);
  });

  it("flags phrase-y single queries over 4 words", () => {
    assert.equal(isPhraseyQuery("building in public AI"), false);
    assert.equal(isPhraseyQuery("shipped my AI"), false);
    assert.equal(isPhraseyQuery("shipping AI tool in public"), true);
    assert.equal(isPhraseyQuery("AI tool launch question"), false);
  });

  it("flags agenda-echo plans as phrase-y", () => {
    assert.equal(
      isPhraseyPlan([
        "shipping AI tool in public",
        "building AI tool in public",
        "AI tool launch question",
        "shipping AI product help",
      ]),
      true,
    );
  });

  it("accepts short diverse high-recall mix", () => {
    assert.equal(
      isPhraseyPlan([
        "building in public AI",
        "shipped my AI",
        "AI builders help",
        "how do I ship",
      ]),
      false,
    );
  });
});

describe("resolveFlashModel", () => {
  it("returns flash model", () => {
    assert.equal(resolveFlashModel(), DEEPSEEK_FLASH_MODEL);
  });
});
