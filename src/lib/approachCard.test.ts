import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canServeApproachOriginal,
  pickApproachSuggestion,
} from "./approachCard.ts";
import type { ForYouSuggestion } from "./forYou.ts";

function row(
  kind: ForYouSuggestion["kind"],
  id = kind,
): ForYouSuggestion {
  return {
    id,
    kind,
    why: "why",
    draft: null,
    targetId: null,
    targetUrl: null,
    targetAuthor: null,
  };
}

describe("canServeApproachOriginal", () => {
  it("is false before a scouted reply today", () => {
    assert.equal(
      canServeApproachOriginal({
        scoutReplyDone: false,
        originalMission: { progress: 0, target: 1, completed: false },
      }),
      false,
    );
  });

  it("is true after a scouted reply while original_1 is open", () => {
    assert.equal(
      canServeApproachOriginal({
        scoutReplyDone: true,
        originalMission: { progress: 0, target: 1, completed: false },
      }),
      true,
    );
  });

  it("is false once original_1 is in", () => {
    assert.equal(
      canServeApproachOriginal({
        scoutReplyDone: true,
        originalMission: { progress: 1, target: 1, completed: true },
      }),
      false,
    );
  });

  it("is false when the mission is missing", () => {
    assert.equal(
      canServeApproachOriginal({ scoutReplyDone: true, originalMission: null }),
      false,
    );
  });
});

describe("pickApproachSuggestion", () => {
  it("prefers a reply over a parked post", () => {
    assert.equal(
      pickApproachSuggestion([row("post"), row("reply")], { allowPost: true })
        ?.kind,
      "reply",
    );
  });

  it("prefers a quote over a parked post", () => {
    assert.equal(
      pickApproachSuggestion([row("post"), row("quote")])?.kind,
      "quote",
    );
  });

  it("hides a parked post until it is earned", () => {
    assert.equal(pickApproachSuggestion([row("post")]), null);
    assert.equal(
      pickApproachSuggestion([row("post")], { allowPost: true })?.kind,
      "post",
    );
  });
});
