import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseQueryPlanJson, validateQueries } from "./queryPlan.ts";
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

describe("resolveFlashModel", () => {
  it("forces flash when pro is requested", () => {
    assert.equal(
      resolveFlashModel({ DEEPSEEK_MODEL: "deepseek-v4-pro" }),
      DEEPSEEK_FLASH_MODEL,
    );
  });

  it("defaults to flash", () => {
    assert.equal(resolveFlashModel({}), DEEPSEEK_FLASH_MODEL);
  });
});
