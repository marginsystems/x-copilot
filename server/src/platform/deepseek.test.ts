import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEEPSEEK_FLASH_MODEL,
  addTokenUsage,
  chatCompletions,
  parseTokenUsage,
  resolveFlashModel,
} from "./deepseek.ts";

await describe("resolveFlashModel", async () => {
  await it("defaults to DeepSeek v4-flash", () => {
    const prev = process.env.DEEPSEEK_MODEL;
    delete process.env.DEEPSEEK_MODEL;
    try {
      assert.equal(resolveFlashModel(), DEEPSEEK_FLASH_MODEL);
      assert.equal(DEEPSEEK_FLASH_MODEL, "deepseek-v4-flash");
    } finally {
      if (prev === undefined) delete process.env.DEEPSEEK_MODEL;
      else process.env.DEEPSEEK_MODEL = prev;
    }
  });
});

await describe("parseTokenUsage / addTokenUsage", async () => {
  await it("parses OpenAI-shaped usage", () => {
    assert.deepEqual(
      parseTokenUsage({
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      }),
      { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    );
  });

  await it("sums usage across calls", () => {
    assert.deepEqual(
      addTokenUsage(
        { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      ),
      { prompt_tokens: 15, completion_tokens: 4, total_tokens: 19 },
    );
  });
});

await describe("chatCompletions response boundaries", async () => {
  await it("preserves success content, model and usage", async (t) => {
    t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
      choices: [{ message: { content: "Ready" } }],
      model: "returned-model",
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    })));
    assert.deepEqual(await chatCompletions({ apiKey: "test", messages: [] }), {
      ok: true,
      content: "Ready",
      model: "returned-model",
      provider: "deepseek",
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    });
  });

  await it("keeps invalid JSON, empty content and malformed content on their existing error paths", async (t) => {
    let response = "";
    t.mock.method(globalThis, "fetch", async () => new Response(response));
    const cases = [
      { raw: "{", error: "invalid_json", status: 200 },
      { raw: "{}", error: "empty_content", status: 200 },
      { raw: "null", error: "deepseek_failed", status: 0 },
      { raw: '{"choices":[{"message":{"content":42}}]}', error: "deepseek_failed", status: 0 },
    ];
    for (const entry of cases) {
      response = entry.raw;
      const result = await chatCompletions({ apiKey: "test", messages: [] });
      assert.equal(result.ok, false);
      if (result.ok) assert.fail("Expected a failed completion");
      assert.equal(result.error, entry.error);
      assert.equal(result.status, entry.status);
    }
  });
});
