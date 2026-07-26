import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toOpenCodeTurns, type ScoutStageEvent } from "./opencodeAdapter.ts";

describe("toOpenCodeTurns", () => {
  it("maps Scout stages into agent turns", () => {
    const events: ScoutStageEvent[] = [
      {
        agent: "scout",
        stage: "planning",
        message: "Scout is planning search queries…",
        at: "2026-07-27T00:00:00.000Z",
      },
      {
        agent: "scout",
        stage: "searching",
        message: "Scout is searching X (query 1/2)…",
        detail: { query: "AI tools" },
        at: "2026-07-27T00:00:01.000Z",
      },
      {
        agent: "scout",
        stage: "error",
        message: "Scout failed: boom",
        at: "2026-07-27T00:00:02.000Z",
      },
    ];
    const turns = toOpenCodeTurns(events);
    assert.equal(turns.length, 3);
    assert.equal(turns[0].role, "assistant");
    assert.equal(turns[1].role, "tool");
    assert.equal(turns[2].status, "failed");
    assert.match(turns[1].detail ?? "", /AI tools/);
  });
});
