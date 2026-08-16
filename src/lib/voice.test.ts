import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEARN_PHASES,
  localEditHint,
  parseVoiceState,
  phaseIndexAt,
  suggestsLeftLabel,
  unlockProgress,
  voiceUnlockCopy,
} from "./voice.ts";

describe("localEditHint", () => {
  const draft = "Shipping small every day beats one big launch. What made you switch?";

  it("flags empty, unchanged, and cosmetic edits", () => {
    assert.ok(localEditHint(draft, "  "));
    assert.ok(localEditHint(draft, draft));
    assert.ok(localEditHint(draft, `${draft}.`));
    assert.ok(localEditHint(draft, draft.toUpperCase()));
    assert.ok(localEditHint(draft, draft.replace("big", "bag")));
  });

  it("flags over-length replies", () => {
    assert.match(localEditHint(draft, "x".repeat(300)) ?? "", /280/);
  });

  it("clears on a real rewrite", () => {
    assert.equal(
      localEditHint(
        draft,
        "Honestly, daily small ships beat a giant launch — what pushed you to switch?",
      ),
      null,
    );
  });
});

describe("voice state parsing", () => {
  it("parses the /api/voice payload", () => {
    const state = parseVoiceState({
      voice: {
        status: "ready",
        handle: "margin",
        replyCount: 140,
        conversationCount: 120,
        unlockAt: 100,
        unlocked: true,
        card: { tone: "dry", typicalLength: "short", habits: [], neverDo: [], examples: ["a"] },
        cardUpdatedAt: "2026-08-15T00:00:00.000Z",
        lastPullAt: "2026-08-15T00:00:00.000Z",
        needsDailyUpdate: false,
        needsLearn: false,
        lastError: null,
        suggests: { used: 3, limit: 10, remaining: 7, canSuggest: true, planKey: "free" },
      },
    });
    assert.equal(state?.status, "ready");
    assert.equal(state?.card?.tone, "dry");
    assert.equal(state?.suggests.remaining, 7);
    assert.equal(state?.needsLearn, false);
    assert.equal(parseVoiceState({}), null);
  });
});

describe("voiceUnlockCopy", () => {
  it("explains the 100-conversation bar when nothing is linked", () => {
    assert.match(voiceUnlockCopy(null), /100 distinct reply conversations/);
    assert.match(voiceUnlockCopy(null), /marked/);
  });
});

describe("phase + meter helpers", () => {
  it("advances phases and holds on the last", () => {
    assert.equal(phaseIndexAt(LEARN_PHASES, 0), 0);
    assert.equal(phaseIndexAt(LEARN_PHASES, 1900), 1);
    assert.equal(phaseIndexAt(LEARN_PHASES, 60_000), LEARN_PHASES.length - 1);
  });

  it("clamps unlock progress", () => {
    assert.equal(unlockProgress({ conversationCount: 50, unlockAt: 100 }), 0.5);
    assert.equal(unlockProgress({ conversationCount: 300, unlockAt: 100 }), 1);
    assert.equal(unlockProgress({ conversationCount: 0, unlockAt: 0 }), 0);
  });

  it("labels suggests left", () => {
    assert.match(
      suggestsLeftLabel({ used: 3, limit: 10, remaining: 7, canSuggest: true, planKey: "free" }),
      /7 of 10/,
    );
    assert.match(
      suggestsLeftLabel({ used: 10, limit: 10, remaining: 0, canSuggest: false, planKey: "free" }),
      /00:00 UTC/,
    );
  });
});
