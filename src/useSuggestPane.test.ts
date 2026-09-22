import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseSuggestResponse } from "./useSuggestPane";

await describe("suggestion response parsing", async () => {
  await it("preserves stances, draft, verification, and usage values", () => {
    const suggests = { used: 2, limit: 5, remaining: 3, canSuggest: true, planKey: "pulse" };
    const response = {
      ok: true, needed: true, fallback: false, options: ["Agree", "Question"],
      draft: "A draft", message: "", error: "suggest_daily_limit", suggests,
      used: 2, limit: 5, planKey: "pulse", pass: true, reason: "Verified",
      intentUrl: "https://x.com/intent/post", canPost: true,
    };
    assert.deepEqual(parseSuggestResponse(response), response);
  });

  await it("rejects malformed stances, text, and quotas without inventing usage", () => {
    const parsed = parseSuggestResponse({
      options: ["Agree", {}], draft: 5, message: {}, reason: [], intentUrl: false,
      used: "2", limit: null, planKey: {}, suggests: { used: 2 },
    });
    for (const key of ["options", "draft", "message", "reason", "intentUrl", "used", "limit", "planKey", "suggests"] as const) {
      assert.equal(parsed[key], undefined);
    }
    assert.equal(parseSuggestResponse(null).ok, undefined);
    assert.equal(parseSuggestResponse({ suggests: {
      used: 2, limit: 5, remaining: "3", canSuggest: true, planKey: "pulse",
    } }).suggests, undefined);
  });
});
