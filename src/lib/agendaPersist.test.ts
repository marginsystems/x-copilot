import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENDA_MAX_CHARS,
  AGENDA_MIN_CHARS,
  agendaNeedsPersist,
} from "./agendaPersist.ts";

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

  it("pins the client length bounds to the server contract", () => {
    assert.equal(AGENDA_MIN_CHARS, 40);
    assert.equal(AGENDA_MAX_CHARS, 5000);
  });

  it("rejects a draft one char under the minimum", () => {
    assert.equal(agendaNeedsPersist("x".repeat(39), null), null);
  });

  it("persists a draft exactly at the minimum", () => {
    assert.equal(agendaNeedsPersist("x".repeat(40), null), "x".repeat(40));
  });

  it("skips a draft over 5000 characters", () => {
    assert.equal(agendaNeedsPersist("x".repeat(5001), null), null);
  });

  it("persists a draft exactly at the maximum", () => {
    assert.equal(agendaNeedsPersist("x".repeat(5000), null), "x".repeat(5000));
  });
});
