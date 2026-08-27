import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { originalsTodayCount } from "./coachingSnapshot.ts";

describe("originalsTodayCount", () => {
  it("takes the strongest of own_posts, desk originals, and confirmed OG cards", () => {
    assert.equal(originalsTodayCount(0, 0, 0), 0);
    assert.equal(originalsTodayCount(0, 0, 1), 1);
    assert.equal(originalsTodayCount(0, 1, 0), 1);
    assert.equal(originalsTodayCount(2, 1, 1), 2);
  });
});
