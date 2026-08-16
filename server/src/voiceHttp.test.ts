import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
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
