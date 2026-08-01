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
        afterSelfReply: 28,
        afterLinks: 22,
        afterLength: 18,
        afterHydrateSelfReply: 15,
        afterTriage: 12,
      }),
      "48 → 36 → 34 → 28 → 22 → 18 → 15 → 12",
    );
  });
});
