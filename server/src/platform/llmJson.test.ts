import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "./llmJson.ts";

await describe("extractJsonObject", async () => {
  await it("parses a fenced JSON object", () => {
    assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  });

  await it("parses the outermost object around surrounding prose", () => {
    assert.deepEqual(extractJsonObject('Sure: {"a":{"b":2}} done'), {
      a: { b: 2 },
    });
  });

  await it("returns null for text without a readable object", () => {
    assert.equal(extractJsonObject("no json here"), null);
    assert.equal(extractJsonObject("{not json}"), null);
  });
});
