import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveNeedsLearn,
  deriveVoiceUiStatus,
  shouldPullXApi,
} from "./voiceHttp.ts";
import type { VoiceProfileRow } from "./voiceStore.ts";

function profile(
  overrides: Partial<VoiceProfileRow> = {},
): VoiceProfileRow {
  return {
    userId: "u1",
    tenantId: "local",
    xUsername: null,
    xUserId: null,
    status: "empty",
    replyCount: 0,
    conversationCount: 0,
    cardJson: null,
    cardModel: null,
    cardUpdatedAt: null,
    sinceId: null,
    lastPullAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("shouldPullXApi", () => {
  it("skips the timeline when memories already unlock", () => {
    assert.equal(
      shouldPullXApi({ conversationCount: 107, handle: "margin" }),
      false,
    );
  });

  it("skips the timeline when there is no handle", () => {
    assert.equal(
      shouldPullXApi({ conversationCount: 40, handle: null }),
      false,
    );
  });

  it("pulls only to fill a short corpus", () => {
    assert.equal(
      shouldPullXApi({ conversationCount: 40, handle: "margin" }),
      true,
    );
  });
});

describe("deriveVoiceUiStatus", () => {
  it("is unlinked only with no corpus and no handle", () => {
    assert.equal(deriveVoiceUiStatus(null, null), "unlinked");
    assert.equal(deriveVoiceUiStatus(profile(), null), "unlinked");
  });

  it("treats memory corpus without a handle as insufficient, not unlinked", () => {
    assert.equal(
      deriveVoiceUiStatus(profile({ conversationCount: 40 }), null),
      "insufficient",
    );
  });

  it("is empty when memories already unlock but the card is not written", () => {
    assert.equal(
      deriveVoiceUiStatus(profile({ conversationCount: 107 }), null),
      "empty",
    );
  });

  it("stays ready when a card exists", () => {
    assert.equal(
      deriveVoiceUiStatus(
        profile({
          status: "ready",
          cardJson: '{"tone":"dry"}',
          conversationCount: 107,
        }),
        null,
      ),
      "ready",
    );
  });
});

describe("deriveNeedsLearn", () => {
  it("arms the first learn for a fresh linked user", () => {
    assert.equal(
      deriveNeedsLearn({
        status: "empty",
        handle: "margin",
        profile: profile(),
        needsDailyUpdate: false,
      }),
      true,
    );
  });

  it("does not re-arm after a truncated pull stamped lastPullAt", () => {
    assert.equal(
      deriveNeedsLearn({
        status: "insufficient",
        handle: "margin",
        profile: profile({
          conversationCount: 40,
          lastPullAt: "2026-08-16T12:00:00.000Z",
        }),
        needsDailyUpdate: false,
      }),
      false,
    );
  });

  it("does not re-arm after a failed learn attempt", () => {
    assert.equal(
      deriveNeedsLearn({
        status: "empty",
        handle: "margin",
        profile: profile({ lastError: "@margin is protected." }),
        needsDailyUpdate: false,
      }),
      false,
    );
  });

  it("still arms the fill-in pull when the corpus was never pulled", () => {
    assert.equal(
      deriveNeedsLearn({
        status: "insufficient",
        handle: "margin",
        profile: profile({ conversationCount: 40 }),
        needsDailyUpdate: false,
      }),
      true,
    );
  });

  it("always arms the once-a-day incremental", () => {
    assert.equal(
      deriveNeedsLearn({
        status: "ready",
        handle: "margin",
        profile: profile({
          status: "ready",
          cardJson: '{"tone":"dry"}',
          conversationCount: 107,
          lastPullAt: "2026-08-15T12:00:00.000Z",
        }),
        needsDailyUpdate: true,
      }),
      true,
    );
  });
});
