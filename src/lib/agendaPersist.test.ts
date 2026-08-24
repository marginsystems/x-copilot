import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agendaNeedsPersist } from "./agendaPersist.ts";

const agenda =
  "Find founders sharing concrete takes on shipping AI tools in public. Prefer a clear point of view.";

describe("agendaNeedsPersist", () => {
  it("returns the trimmed draft when it differs from saved", () => {
    assert.equal(agendaNeedsPersist(`  ${agenda}  `, "old agenda ".repeat(4)), agenda);
  });

  it("skips a draft that is already saved", () => {
    assert.equal(agendaNeedsPersist(`  ${agenda}  `, agenda), null);
  });

  it("skips a draft under 40 characters", () => {
    assert.equal(agendaNeedsPersist("too short", null), null);
  });

  it("persists a first valid draft when nothing is saved yet", () => {
    assert.equal(agendaNeedsPersist(agenda, null), agenda);
  });
});
