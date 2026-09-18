import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_REPLY_CHARS,
  buildComposeIntentUrl,
  buildIntentUrl,
  checkTrivialEdit,
  editDistanceCapped,
  normalizeForEditCompare,
  trivialEditNote,
} from "./voiceEdit.ts";

describe("voiceEdit forced-edit gate", () => {
  const draft =
    "Shipping small every day beats one big launch. What made you switch?";

  it("rejects an unchanged reply", () => {
    assert.deepEqual(checkTrivialEdit(draft, draft), {
      trivial: true,
      reason: "unchanged",
    });
    assert.deepEqual(checkTrivialEdit(draft, `  ${draft}  `), {
      trivial: true,
      reason: "unchanged",
    });
  });

  it("rejects an empty rewrite", () => {
    assert.deepEqual(checkTrivialEdit(draft, "   "), {
      trivial: true,
      reason: "empty",
    });
  });

  it("rejects punctuation-only edits (add a period/comma)", () => {
    assert.equal(checkTrivialEdit(draft, `${draft}.`).trivial, true);
    assert.equal(
      checkTrivialEdit(draft, draft.replace("launch.", "launch,")).trivial,
      true,
    );
    assert.equal(checkTrivialEdit(draft, draft.replace("?", "!!!")).trivial, true);
    assert.equal(checkTrivialEdit(draft, "???").trivial, true);
  });

  it("rejects whitespace-only edits", () => {
    assert.equal(
      checkTrivialEdit(draft, draft.replace(/ /g, "  ")).trivial,
      true,
    );
    assert.equal(
      checkTrivialEdit(draft, draft.replace(". ", ".\n")).trivial,
      true,
    );
  });

  it("rejects case-only edits", () => {
    assert.equal(checkTrivialEdit(draft, draft.toUpperCase()).trivial, true);
    assert.equal(checkTrivialEdit(draft, draft.toLowerCase()).trivial, true);
  });

  it("rejects single-character edits", () => {
    assert.equal(checkTrivialEdit(draft, draft.replace("big", "bag")).trivial, true);
    assert.equal(checkTrivialEdit(draft, `${draft}s`).trivial, true);
  });

  it("passes a real rewrite even with the same meaning", () => {
    const rewrite =
      "Honestly, daily small ships beat a giant launch every time — curious what pushed you to switch?";
    assert.deepEqual(checkTrivialEdit(draft, rewrite), { trivial: false });
  });

  it("passes when a clause is added", () => {
    const rewrite = `${draft} We learned this the hard way at my last startup.`;
    assert.deepEqual(checkTrivialEdit(draft, rewrite), { trivial: false });
  });

  it("has a kind note for every rejection", () => {
    for (const reason of ["empty", "unchanged", "cosmetic_only", "too_small"] as const) {
      assert.ok(trivialEditNote(reason).length > 10);
    }
  });

  it("normalizes case, whitespace, and punctuation away", () => {
    assert.equal(
      normalizeForEditCompare("Hello,   WORLD!!!"),
      normalizeForEditCompare("hello world"),
    );
  });

  it("caps edit distance work", () => {
    assert.equal(editDistanceCapped("abc", "abc", 2), 0);
    assert.equal(editDistanceCapped("abc", "abd", 2), 1);
    assert.equal(editDistanceCapped("abc", "xyzabcdef", 2), 3);
  });
});

describe("buildIntentUrl", () => {
  it("builds the x.com reply intent with encoded text", () => {
    const url = buildIntentUrl(
      "1950000000000000001",
      "great point & agreed — 100%?",
    );
    const parsed = new URL(url);
    assert.equal(parsed.origin, "https://x.com");
    assert.equal(parsed.pathname, "/intent/tweet");
    assert.equal(parsed.searchParams.get("in_reply_to"), "1950000000000000001");
    assert.equal(parsed.searchParams.get("text"), "great point & agreed — 100%?");
  });

  it("refuses non-numeric status ids", () => {
    assert.throws(() => buildIntentUrl("javascript:alert(1)", "hi"));
    assert.throws(() => buildIntentUrl("", "hi"));
  });

  it("keeps the X reply cap in one place", () => {
    assert.equal(MAX_REPLY_CHARS, 280);
  });
});

describe("buildComposeIntentUrl", () => {
  it("builds an original compose intent without in_reply_to", () => {
    const url = buildComposeIntentUrl("ship the recap & go");
    const parsed = new URL(url);
    assert.equal(parsed.pathname, "/intent/tweet");
    assert.equal(parsed.searchParams.get("text"), "ship the recap & go");
    assert.equal(parsed.searchParams.get("in_reply_to"), null);
  });

  it("attaches a quote url and refuses a non-numeric quote id", () => {
    const url = buildComposeIntentUrl("still true", "99");
    const parsed = new URL(url);
    assert.equal(
      parsed.searchParams.get("url"),
      "https://x.com/i/status/99",
    );
    assert.throws(() => buildComposeIntentUrl("hi", "javascript:alert(1)"));
  });
});
