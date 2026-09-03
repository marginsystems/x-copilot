import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keepByMinViews } from "./useDeskHistory.ts";

const enabled = { filterByMinViews: true, minViews: 100 };

describe("keepByMinViews", () => {
  it("drops an OP below the floor and keeps the inclusive floor", () => {
    assert.equal(keepByMinViews({ views: 99 }, enabled), false);
    assert.equal(keepByMinViews({ views: 100 }, enabled), true);
  });

  it("keeps replies when OP views are unknown", () => {
    assert.equal(keepByMinViews({ inReplyToId: "op" }, enabled), true);
  });

  it("keeps every thread when the filter is disabled", () => {
    const disabled = { filterByMinViews: false, minViews: 100 };
    assert.equal(keepByMinViews({ views: 0 }, disabled), true);
    assert.equal(keepByMinViews({}, disabled), true);
  });
});
