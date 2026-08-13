import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_AGENDA_CHARS,
  MIN_AGENDA_CHARS,
  validateAgendaText,
} from "./onboarding.ts";

describe("validateAgendaText", () => {
  it("accepts a trimmed agenda in range", () => {
    const agenda = "Find builders sharing opinions on shipping AI tools in public.";
    const parsed = validateAgendaText(`  ${agenda}  `);
    assert.deepEqual(parsed, { ok: true, agenda });
  });

  it("rejects short or missing text", () => {
    assert.equal(validateAgendaText("too short").ok, false);
    assert.equal(validateAgendaText("   ").ok, false);
    assert.equal(validateAgendaText(null).ok, false);
    assert.equal(validateAgendaText(1).ok, false);
  });

  it("rejects overlong text", () => {
    const parsed = validateAgendaText("x".repeat(MAX_AGENDA_CHARS + 1));
    assert.equal(parsed.ok, false);
    if (!parsed.ok) assert.equal(parsed.error, "agenda_too_long");
  });

  it("documents the minimum length", () => {
    assert.equal(MIN_AGENDA_CHARS, 40);
  });
});
