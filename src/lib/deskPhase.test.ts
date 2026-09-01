import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DESK_PHASES,
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

  it("lets a pace lock win over scout and organic inventory", () => {
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

  it("uses scout inventory first with empty beats", () => {
    phase("scout_reply", {
      hasScoutCard: true,
      hasSuggestion: true,
    });
  });

  it("uses suggestion inventory when no scout card exists", () => {
    phase("organic_reply", { hasSuggestion: true });
  });

  it("silently refuels an empty tank regardless of searching", () => {
    phase("silent_refuel", { searching: false });
    phase("silent_refuel", { searching: true });
  });

  it("moves a completed scout reply to organic reply", () => {
    phase("organic_reply", {
      hasScoutCard: true,
      beats: {
        ...emptyDeskBeats(),
        scoutReplyDone: true,
      },
    });
  });

  it("moves a completed organic reply to the fork", () => {
    phase("fork", {
      beats: {
        ...emptyDeskBeats(),
        organicReplyDone: true,
      },
    });
  });

  it("uses the original fork choice", () => {
    phase("original", {
      beats: {
        ...emptyDeskBeats(),
        forkChoice: "original",
      },
    });
  });

  it("uses scout inventory for the reply fork choice", () => {
    phase("scout_reply", {
      hasScoutCard: true,
      beats: {
        ...emptyDeskBeats(),
        forkChoice: "reply",
      },
    });
  });

  it("falls back through organic inventory and silent refuel for reply", () => {
    const beats = {
      ...emptyDeskBeats(),
      forkChoice: "reply" as const,
    };

    phase("organic_reply", { hasSuggestion: true, beats });
    phase("silent_refuel", { beats });
  });

  it("lets fork completion win over leftover inventory", () => {
    phase("done_for_now", {
      hasScoutCard: true,
      hasSuggestion: true,
      beats: {
        scoutReplyDone: true,
        organicReplyDone: true,
        forkChoice: "reply",
        forkDone: true,
      },
    });
  });

  it("sets hold only for the hold phase", () => {
    assert.deepEqual(read({ paceLocked: true }), {
      phase: "hold",
      hold: true,
    });

    for (const expected of DESK_PHASES) {
      if (expected === "hold") continue;

      const result =
        expected === "needs_onboarding"
          ? read({ needsOnboarding: true })
          : expected === "scout_reply"
            ? read({ hasScoutCard: true })
            : expected === "organic_reply"
              ? read({ hasSuggestion: true })
              : expected === "fork"
                ? read({
                    beats: {
                      ...emptyDeskBeats(),
                      organicReplyDone: true,
                    },
                  })
                : expected === "original"
                  ? read({
                      beats: {
                        ...emptyDeskBeats(),
                        forkChoice: "original",
                      },
                    })
                  : expected === "done_for_now"
                    ? read({
                        beats: {
                          ...emptyDeskBeats(),
                          forkDone: true,
                        },
                      })
                    : read();

      assert.equal(result.phase, expected);
      assert.equal(result.hold, false);
    }
  });
});

describe("approachTabLiveCount", () => {
  it("counts the card on the desk, not parked inventory", () => {
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
        phase: "done_for_now",
        hasScoutCard: true,
        hasSuggestion: true,
      }),
      0,
    );
    assert.equal(
      approachTabLiveCount({
        phase: "silent_refuel",
        hasScoutCard: false,
        hasSuggestion: false,
      }),
      0,
    );
  });
});
