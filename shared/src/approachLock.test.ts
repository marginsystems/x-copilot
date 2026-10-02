import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseApproachLock } from "./approachLock.ts";

await describe("Approach lock parsing", () => {
  it("rejects garbage and snapshots without a valid phase", () => {
    assert.equal(parseApproachLock("not json"), null);
    assert.equal(
      parseApproachLock(JSON.stringify({ cardId: "1", surface: null })),
      null,
    );
    assert.equal(
      parseApproachLock(
        JSON.stringify({ phase: "fork", cardId: null, surface: null }),
      ),
      null,
    );
    assert.equal(
      parseApproachLock(
        JSON.stringify({ phase: "original", cardId: null, surface: null }),
      ),
      null,
    );
  }).catch(assert.fail);
});
