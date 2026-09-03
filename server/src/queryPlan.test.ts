import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  agendaContentWords,
  hasAgendaNounQueries,
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
      '{"queries":["AI tools","building in public","is:reply AI"]}',
    );
    assert.deepEqual(q, [
      "AI tools",
      "building in public",
      "is:reply AI",
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

describe("hasAgendaNounQueries", () => {
  const genericPlan = [
    "just shipped",
    "AI launch",
    "building AI",
    "shipping soon",
  ];

  it("rejects a generic plan against a specific agenda", () => {
    assert.equal(
      hasAgendaNounQueries(genericPlan, "B2B freight OS"),
      false,
    );
    assert.equal(
      hasAgendaNounQueries(
        genericPlan,
        "building a freight operating system for carriers",
      ),
      false,
    );
  });

  it("accepts a 2-word plan with two agenda-noun queries", () => {
    assert.equal(
      hasAgendaNounQueries(
        [
          "Freight software",
          "carriers hiring",
          "just shipped",
          "shipping soon",
        ],
        "building a freight operating system for carriers",
      ),
      true,
    );
  });

  it("drops stopwords and tiny agenda words", () => {
    assert.deepEqual(
      [...agendaContentWords("Building a B2B freight OS for carriers")],
      ["building", "b2b", "freight", "carriers"],
    );
  });

  it("does not count search operators as agenda nouns", () => {
    assert.equal(
      hasAgendaNounQueries(
        ["min_faves launch", "-is:reply shipped", "just freight"],
        "min faves replies freight",
      ),
      false,
    );
  });
});

describe("resolveFlashModel", () => {
  it("returns DeepSeek v4-flash", () => {
    const prev = process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_MODEL;
    try {
      assert.equal(resolveFlashModel(), DEEPSEEK_FLASH_MODEL);
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = prev;
    }
  });
});
