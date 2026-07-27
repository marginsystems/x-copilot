import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPipelineFunnel } from "./scoutRun.ts";

describe("formatPipelineFunnel", () => {
  it("formats raw → … → triage counts", () => {
    assert.equal(
      formatPipelineFunnel({
        raw: 48,
        afterDedupe: 36,
        afterCooldown: 34,
        afterLength: 18,
        afterTriage: 12,
      }),
      "48 → 36 → 34 → 18 → 12",
    );
  });
});
