import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LEARN_PHASES,
  localEditHint,
  parseVoiceState,
  phaseIndexAt,
  suggestsLeftLabel,
  unlockProgress,
  shouldShowVoiceUnlockToast,
  voiceNeedsXLink,
  voiceUnlockCopy,
  VOICE_LINK_X_COPY,
  type VoiceState,
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
  it("explains the 100-post bar when state has not loaded", () => {
    assert.match(voiceUnlockCopy(null), /100 public posts/);
    assert.match(voiceUnlockCopy(null), /hourly/);
  });

  it("asks to link X when the API says unlinked", () => {
    assert.equal(
      voiceUnlockCopy({
        status: "unlinked",
        handle: null,
        replyCount: 0,
        conversationCount: 0,
        unlockAt: 100,
        unlocked: false,
        card: null,
        cardUpdatedAt: null,
        lastPullAt: null,
        needsDailyUpdate: false,
        needsLearn: false,
        lastError: null,
        suggests: {
          used: 0,
          limit: 10,
          remaining: 10,
          canSuggest: true,
          planKey: "free",
        },
      }),
      VOICE_LINK_X_COPY,
    );
  });
});

describe("shouldShowVoiceUnlockToast", () => {
  const locked: VoiceState = {
    status: "insufficient",
    handle: "margin",
    replyCount: 40,
    conversationCount: 40,
    unlockAt: 100,
    unlocked: false,
    card: null,
    cardUpdatedAt: null,
    lastPullAt: null,
    needsDailyUpdate: false,
    needsLearn: false,
    lastError: null,
    suggests: {
      used: 0,
      limit: 10,
      remaining: 10,
      canSuggest: true,
      planKey: "free",
    },
  };

  it("stays hidden until Voice has loaded", () => {
    assert.equal(
      shouldShowVoiceUnlockToast({ voice: null, hasSession: true }),
      false,
    );
  });

  it("stays hidden without a session", () => {
    assert.equal(
      shouldShowVoiceUnlockToast({ voice: locked, hasSession: false }),
      false,
    );
  });

  it("stays hidden when Suggest is already unlocked", () => {
    assert.equal(
      shouldShowVoiceUnlockToast({
        voice: { ...locked, status: "ready", unlocked: true, replyCount: 120 },
        hasSession: true,
      }),
      false,
    );
  });

  it("shows only after load while Suggest is still locked", () => {
    assert.equal(
      shouldShowVoiceUnlockToast({ voice: locked, hasSession: true }),
      true,
    );
  });
});

describe("voiceNeedsXLink", () => {
  it("is true with no official X link and no voice payload yet", () => {
    assert.equal(voiceNeedsXLink(null, null), true);
    assert.equal(voiceNeedsXLink(null, false), true);
  });

  it("is false once official X is linked or a voice handle exists", () => {
    assert.equal(voiceNeedsXLink(null, true), false);
    assert.equal(
      voiceNeedsXLink(
        {
          status: "unlinked",
          handle: "alice",
          replyCount: 0,
          conversationCount: 0,
          unlockAt: 100,
          unlocked: false,
          card: null,
          cardUpdatedAt: null,
          lastPullAt: null,
          needsDailyUpdate: false,
          needsLearn: false,
          lastError: null,
          suggests: {
            used: 0,
            limit: 10,
            remaining: 10,
            canSuggest: true,
            planKey: "free",
          },
        },
        null,
      ),
      false,
    );
  });

  it("is true when the API says unlinked with no handle", () => {
    assert.equal(
      voiceNeedsXLink(
        {
          status: "unlinked",
          handle: null,
          replyCount: 0,
          conversationCount: 0,
          unlockAt: 100,
          unlocked: false,
          card: null,
          cardUpdatedAt: null,
          lastPullAt: null,
          needsDailyUpdate: false,
          needsLearn: false,
          lastError: null,
          suggests: {
            used: 0,
            limit: 10,
            remaining: 10,
            canSuggest: true,
            planKey: "free",
          },
        },
        null,
      ),
      true,
    );
  });

  it("stays true without official X even when a stale corpus exists", () => {
    assert.equal(
      voiceNeedsXLink(
        {
          status: "insufficient",
          handle: null,
          replyCount: 12,
          conversationCount: 8,
          unlockAt: 100,
          unlocked: false,
          card: null,
          cardUpdatedAt: null,
          lastPullAt: null,
          needsDailyUpdate: false,
          needsLearn: false,
          lastError: null,
          suggests: {
            used: 0,
            limit: 10,
            remaining: 10,
            canSuggest: true,
            planKey: "free",
          },
        },
        null,
      ),
      true,
    );
  });
});

describe("phase + meter helpers", () => {
  it("advances phases and holds on the last", () => {
    assert.equal(phaseIndexAt(LEARN_PHASES, 0), 0);
    assert.equal(phaseIndexAt(LEARN_PHASES, 1900), 1);
    assert.equal(phaseIndexAt(LEARN_PHASES, 60_000), LEARN_PHASES.length - 1);
  });

  it("clamps unlock progress", () => {
    assert.equal(unlockProgress({ replyCount: 50, unlockAt: 100 }), 0.5);
    assert.equal(unlockProgress({ replyCount: 300, unlockAt: 100 }), 1);
    assert.equal(unlockProgress({ replyCount: 0, unlockAt: 0 }), 0);
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
