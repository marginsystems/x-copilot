import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEEPSEEK_FLASH_MODEL,
  addTokenUsage,
  parseTokenUsage,
  resolveFlashModel,
} from "./deepseek.ts";

describe("resolveFlashModel", () => {
  it("defaults to DeepSeek v4-flash", () => {
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

describe("parseTokenUsage / addTokenUsage", () => {
  it("parses OpenAI-shaped usage", () => {
    assert.deepEqual(
      parseTokenUsage({
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      }),
      { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
    );
  });

  it("sums usage across calls", () => {
    assert.deepEqual(
      addTokenUsage(
        { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
        { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      ),
      { prompt_tokens: 15, completion_tokens: 4, total_tokens: 19 },
    );
  });
});
