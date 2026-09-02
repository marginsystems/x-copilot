import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sortThreadsByAudience,
  sortThreadsByCreatedAtNewest,
} from "./threadSort.ts";

describe("sortThreadsByCreatedAtNewest", () => {
  it("orders newest first", () => {
    const sorted = sortThreadsByCreatedAtNewest([
      { id: "old", createdAt: "2026-07-20T12:00:00.000Z" },
      { id: "new", createdAt: "2026-07-28T12:00:00.000Z" },
      { id: "mid", createdAt: "2026-07-25T12:00:00.000Z" },
    ]);
    assert.deepEqual(
      sorted.map((t) => t.id),
      ["new", "mid", "old"],
    );
  });

  it("sinks missing createdAt to the bottom", () => {
    const sorted = sortThreadsByCreatedAtNewest([
      { id: "nope" },
      { id: "new", createdAt: "2026-07-28T12:00:00.000Z" },
      { id: "bad", createdAt: "not-a-date" },
    ]);
    assert.equal(sorted[0]?.id, "new");
    assert.ok(["nope", "bad"].includes(sorted[1]?.id ?? ""));
    assert.ok(["nope", "bad"].includes(sorted[2]?.id ?? ""));
  });
});

describe("sortThreadsByAudience", () => {
  it("orders highest views first", () => {
    const sorted = sortThreadsByAudience([
      { id: "quiet", views: 3 },
      { id: "loud", views: 655 },
      { id: "none" },
    ]);
    assert.deepEqual(
      sorted.map((t) => t.id),
      ["loud", "quiet", "none"],
    );
  });
});
