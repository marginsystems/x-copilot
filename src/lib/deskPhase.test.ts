import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  approachTabLiveCount,
  deskPhase,
  emptyDeskBeats,
  type DeskPhase,
  type DeskPhaseInput,
} from "./deskPhase.ts";

function read(
  overrides: Partial<DeskPhaseInput> = {},
) {
  return deskPhase({
    needsOnboarding: false,
    paceLocked: false,
    overheat: false,
    hasScoutCard: false,
    hasSuggestion: false,
    searching: false,
    beats: emptyDeskBeats(),
    ...overrides,
  });
}

function phase(
  expected: DeskPhase,
  overrides: Partial<DeskPhaseInput> = {},
) {
  assert.equal(read(overrides).phase, expected);
}

describe("emptyDeskBeats", () => {
  it("returns all-false beats with no fork choice", () => {
    assert.deepEqual(emptyDeskBeats(), {
      scoutReplyDone: false,
      organicReplyDone: false,
      forkChoice: null,
      forkDone: false,
    });
  });
});

describe("deskPhase", () => {
  it("lets onboarding win over hold and inventory", () => {
    phase("needs_onboarding", {
      needsOnboarding: true,
      paceLocked: true,
      overheat: true,
      hasScoutCard: true,
      hasSuggestion: true,
    });
  });

  it("lets a pace lock win over scout and suggested inventory", () => {
    phase("hold", {
      paceLocked: true,
      hasScoutCard: true,
      hasSuggestion: true,
    });
  });

  it("holds for overheat while pace is unlocked", () => {
    phase("hold", {
      paceLocked: false,
      overheat: true,
    });
  });

  it("serves Scout first when both tanks have cards", () => {
    phase("scout_reply", {
      hasScoutCard: true,
      hasSuggestion: true,
    });
  });

  it("serves Suggested when Scout is empty", () => {
    phase("organic_reply", { hasSuggestion: true });
  });

  it("refuels only when both tanks are empty", () => {
    phase("silent_refuel", { searching: false });
    phase("silent_refuel", { searching: true });
  });

  it("keeps For You on the desk after Scout fills the tank", () => {
    phase("silent_refuel", {
      holdForYouTask: true,
      hasScoutCard: true,
      hasSuggestion: true,
    });
  });

  it("lets a pace lock win over a held For You task", () => {
    phase("hold", {
      paceLocked: true,
      holdForYouTask: true,
      hasScoutCard: true,
    });
  });

  it("keeps serving the tank after beats say the day is done", () => {
    const done = {
      scoutReplyDone: true,
      organicReplyDone: true,
      forkChoice: "reply" as const,
      forkDone: true,
    };
    phase("scout_reply", { hasScoutCard: true, hasSuggestion: true, beats: done });
    phase("organic_reply", { hasSuggestion: true, beats: done });
    phase("silent_refuel", { beats: done });
  });

  it("does not swap a live Scout card for a fork or original beat", () => {
    phase("scout_reply", {
      hasScoutCard: true,
      beats: {
        ...emptyDeskBeats(),
        organicReplyDone: true,
      },
    });
    phase("scout_reply", {
      hasScoutCard: true,
      beats: {
        ...emptyDeskBeats(),
        forkChoice: "original",
      },
    });
  });

  it("sets hold only for the hold phase", () => {
    assert.deepEqual(read({ paceLocked: true }), {
      phase: "hold",
      hold: true,
    });
    assert.equal(read({ hasScoutCard: true }).hold, false);
    assert.equal(read({ hasSuggestion: true }).hold, false);
    assert.equal(read().hold, false);
  });
});

describe("approachTabLiveCount", () => {
  it("counts the card on the desk", () => {
    assert.equal(
      approachTabLiveCount({
        phase: "scout_reply",
        hasScoutCard: true,
        hasSuggestion: true,
      }),
      1,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "organic_reply",
        hasScoutCard: false,
        hasSuggestion: true,
      }),
      1,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "silent_refuel",
        hasScoutCard: false,
        hasSuggestion: false,
      }),
      0,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "silent_refuel",
        hasScoutCard: true,
        hasSuggestion: false,
        holdForYouTask: true,
      }),
      1,
    );
  });
});
