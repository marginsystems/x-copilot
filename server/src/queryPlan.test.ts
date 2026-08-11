import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isPhraseyPlan,
  isPhraseyQuery,
  parseQueryPlanJson,
  queryWordCount,
  validateQueries,
} from "./queryPlan.ts";
import {
  resolveFlashModel,
  DEEPSEEK_FLASH_MODEL,
  GEMINI_FLASH_MODEL,
} from "./deepseek.ts";

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
    assert.equal(queryWordCount("just shipped"), 2);
  });

  it("flags single queries over 3 words as phrase-y (4+)", () => {
    assert.equal(isPhraseyQuery("just shipped"), false);
    assert.equal(isPhraseyQuery("shipped my AI"), false);
    assert.equal(isPhraseyQuery("AI tool launch question"), true);
    assert.equal(isPhraseyQuery("building in public AI"), true);
    assert.equal(isPhraseyQuery("shipping AI tool in public"), true);
  });

  it("accepts mostly 2-word high-recall plans", () => {
    assert.equal(
      isPhraseyPlan([
        "just shipped",
        "AI launch",
        "building AI",
        "shipping soon",
      ]),
      false,
    );
  });

  it("flags all-3-word plans as phrase-y (prefer 2-word)", () => {
    assert.equal(
      isPhraseyPlan([
        "shipping AI tool",
        "AI launch question",
        "building AI product",
        "AI tool feedback",
      ]),
      true,
    );
  });

  it("flags agenda-echo / long plans as phrase-y", () => {
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

  it("allows a minority of 3-word queries in a 2-word-heavy plan", () => {
    assert.equal(
      isPhraseyPlan([
        "just shipped",
        "AI launch",
        "building AI",
        "shipped my tool",
      ]),
      false,
    );
  });
});

describe("resolveFlashModel", () => {
  it("returns flash model per provider", () => {
    assert.equal(resolveFlashModel(), GEMINI_FLASH_MODEL);
    assert.equal(resolveFlashModel("deepseek"), DEEPSEEK_FLASH_MODEL);
  });
});
