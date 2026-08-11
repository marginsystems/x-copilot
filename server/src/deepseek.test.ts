import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LLM_PROVIDER,
  DEEPSEEK_FLASH_MODEL,
  GEMINI_FLASH_MODEL,
  addTokenUsage,
  normalizeLlmProvider,
  parseTokenUsage,
  resolveFlashModel,
} from "./deepseek.ts";

describe("normalizeLlmProvider", () => {
  it("defaults to gemini", () => {
    assert.equal(normalizeLlmProvider(undefined), "gemini");
    assert.equal(normalizeLlmProvider("nope"), DEFAULT_LLM_PROVIDER);
  });

  it("accepts deepseek and gemini", () => {
    assert.equal(normalizeLlmProvider("deepseek"), "deepseek");
    assert.equal(normalizeLlmProvider("gemini"), "gemini");
  });
});

describe("resolveFlashModel", () => {
  it("returns flash defaults per provider", () => {
    assert.equal(resolveFlashModel("deepseek"), DEEPSEEK_FLASH_MODEL);
    assert.equal(resolveFlashModel("gemini"), GEMINI_FLASH_MODEL);
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

  it("parses Gemini camelCase usage", () => {
    assert.deepEqual(
      parseTokenUsage({
        promptTokenCount: 8,
        candidatesTokenCount: 2,
        totalTokenCount: 10,
      }),
      { prompt_tokens: 8, completion_tokens: 2, total_tokens: 10 },
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
