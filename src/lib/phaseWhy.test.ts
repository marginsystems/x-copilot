import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyDeskBeats } from "./deskPhase.ts";
import { coachingMatchesCard, phaseWhy } from "./phaseWhy.ts";
import type { CoachingState, NextActionKind } from "./coaching.ts";
import type { ForYouSuggestion } from "./forYou.ts";

function coaching(kind: NextActionKind, text: string): CoachingState {
  return {
    dayUtc: "2026-09-03",
    nextAction: { kind, text, updatedAt: "" },
    missions: [],
    beats: emptyDeskBeats(),
  };
}

const post: ForYouSuggestion = {
  id: "s1",
  kind: "post",
  why: "900 views",
  draft: "Ship a recap.",
  targetId: null,
  targetUrl: null,
  targetAuthor: null,
};

describe("coachingMatchesCard", () => {
  it("keeps reply and streak on a scouted card", () => {
    assert.equal(coachingMatchesCard("scout_reply", "reply"), true);
    assert.equal(coachingMatchesCard("scout_reply", "streak"), true);
    assert.equal(coachingMatchesCard("scout_reply", "original"), false);
    assert.equal(coachingMatchesCard("scout_reply", "for_you"), false);
    assert.equal(coachingMatchesCard("scout_reply", "takeoff"), false);
  });

  it("matches Suggested kinds", () => {
    assert.equal(coachingMatchesCard("organic_reply", "original", "post"), true);
    assert.equal(coachingMatchesCard("organic_reply", "quote", "quote"), true);
    assert.equal(coachingMatchesCard("organic_reply", "original", "reply"), false);
  });
});

describe("phaseWhy", () => {
  it("does not put original copy on a scouted reply", () => {
    assert.equal(
      phaseWhy(
        "scout_reply",
        coaching(
          "original",
          "Write one original post today to share your insight from those 7 replies you already gave.",
        ),
      ),
      "Reply to this thread. Then mark it.",
    );
  });

  it("keeps a reply line on a scouted card", () => {
    assert.equal(
      phaseWhy(
        "scout_reply",
        coaching("reply", "Reply to this thread. Then mark it."),
      ),
      "Reply to this thread. Then mark it.",
    );
  });

  it("keeps compose copy on an original card", () => {
    assert.equal(
      phaseWhy("organic_reply", coaching("reply", "Mark a reply."), post),
      "Compose an original. Mark it here.",
    );
  });
});
