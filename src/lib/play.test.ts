import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CoachingState, DailyMission } from "./coaching.ts";
import { emptyGamificationStats } from "./gamification.ts";
import {
  PLAY_TO_DESK_LABEL,
  playSceneFromState,
  playStateClass,
} from "./play.ts";

function mission(partial: Partial<DailyMission> & Pick<DailyMission, "id">): DailyMission {
  return {
    label: partial.label ?? partial.id,
    target: partial.target ?? 1,
    progress: partial.progress ?? 0,
    xpReward: partial.xpReward ?? 1,
    completed: partial.completed ?? false,
    claimed: partial.claimed ?? false,
    ...partial,
  };
}

function coaching(partial: Partial<CoachingState> = {}): CoachingState {
  return {
    dayUtc: "2026-08-27",
    nextAction: null,
    missions: [
      mission({ id: "mark_2", label: "Mark 2 replies", target: 2 }),
      mission({ id: "original_1", label: "Post 1 original" }),
      mission({ id: "takeoff_1", label: "Take off once" }),
    ],
    ...partial,
  };
}

describe("playSceneFromState", () => {
  it("sleeps when nothing happened today and there is no next action", () => {
    const scene = playSceneFromState(
      coaching(),
      { ...emptyGamificationStats(), lastMarkUtcDay: "2026-08-26" },
    );
    assert.equal(scene.state, "sleep");
    assert.equal(scene.perchLit, false);
  });

  it("nudges when a next-action card is present", () => {
    const scene = playSceneFromState(
      coaching({
        nextAction: {
          kind: "reply",
          text: "Mark a reply to keep the streak.",
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
      }),
      emptyGamificationStats(),
    );
    assert.equal(scene.state, "nudge");
    assert.equal(scene.speech, "Mark a reply to keep the streak.");
    assert.equal(scene.speechKind, "Reply");
  });

  it("lights the perch only when lastMarkUtcDay is today", () => {
    const today = coaching();
    const lit = playSceneFromState(today, {
      ...emptyGamificationStats(),
      lastMarkUtcDay: "2026-08-27",
    });
    const dark = playSceneFromState(today, {
      ...emptyGamificationStats(),
      lastMarkUtcDay: "2026-08-26",
    });
    assert.equal(lit.perchLit, true);
    assert.equal(dark.perchLit, false);
  });

  it("falls back to sleep when coaching is null", () => {
    const scene = playSceneFromState(null, emptyGamificationStats());
    assert.equal(scene.state, "sleep");
    assert.equal(scene.perchLit, false);
    assert.equal(scene.speech, null);
    assert.equal(scene.dayUtc, "");
    assert.deepEqual(scene.missions, []);
  });

  it("is idle after today's work when there is no next action", () => {
    const scene = playSceneFromState(
      coaching({
        missions: [
          mission({ id: "mark_2", progress: 2, completed: true, claimed: true }),
        ],
      }),
      { ...emptyGamificationStats(), lastMarkUtcDay: "2026-08-27", level: 4, currentStreak: 3 },
    );
    assert.equal(scene.state, "idle");
    assert.equal(scene.perchLit, true);
    assert.deepEqual(scene.claimedMissionIds, ["mark_2"]);
    assert.equal(scene.level, 4);
    assert.equal(scene.currentStreak, 3);
  });

  it("never celebrates until the last-seen cursor exists", () => {
    const scene = playSceneFromState(
      coaching({
        nextAction: {
          kind: "original",
          text: "Post one original.",
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
        missions: [
          mission({ id: "original_1", progress: 1, completed: true, claimed: true }),
        ],
      }),
      {
        ...emptyGamificationStats(),
        lastMarkUtcDay: "2026-08-27",
        level: 5,
      },
    );
    assert.notEqual(scene.state, "celebrate");
    assert.equal(scene.state, "nudge");
    assert.equal(scene.celebrateLine, null);
  });

  it("nudges instead of sleeping when a next action exists", () => {
    const scene = playSceneFromState(
      coaching({
        nextAction: {
          kind: "reply",
          text: "Mark a reply to keep the streak.",
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
      }),
      { ...emptyGamificationStats(), lastMarkUtcDay: "2026-08-26" },
    );
    assert.equal(scene.state, "nudge");
    assert.equal(scene.speech, "Mark a reply to keep the streak.");
  });

  it("keeps the To the desk label as product copy", () => {
    assert.equal(PLAY_TO_DESK_LABEL, "To the desk");
  });

  it("lets a cursor delta outrank nudge", () => {
    const scene = playSceneFromState(
      coaching({
        nextAction: {
          kind: "reply",
          text: "Mark a reply to keep the streak.",
          updatedAt: "2026-08-27T12:00:00.000Z",
        },
      }),
      emptyGamificationStats(),
      { kind: "mission", line: "Mark 2 replies · +4 XP" },
    );
    assert.equal(scene.state, "celebrate");
    assert.equal(scene.celebrateLine, "Mark 2 replies · +4 XP");
  });

  it("does not light the perch when dayUtc is empty", () => {
    const scene = playSceneFromState(
      coaching({ dayUtc: "" }),
      { ...emptyGamificationStats(), lastMarkUtcDay: "" },
    );
    assert.equal(scene.perchLit, false);
  });
});

describe("playStateClass", () => {
  it("maps idle with a lit perch", () => {
    assert.equal(
      playStateClass({ state: "idle", perchLit: true }),
      "is-idle is-lit",
    );
  });

  it("maps celebrate with the lamp independent of the pose", () => {
    assert.equal(
      playStateClass({ state: "celebrate", perchLit: false }),
      "is-celebrate",
    );
    assert.equal(
      playStateClass({ state: "celebrate", perchLit: true }),
      "is-celebrate is-lit",
    );
  });

  it("maps nudge", () => {
    assert.equal(playStateClass({ state: "nudge", perchLit: false }), "is-nudge");
  });

  it("forces the lamp off while asleep", () => {
    assert.equal(playStateClass({ state: "sleep", perchLit: true }), "is-sleep");
  });

  it("accepts a full derived scene", () => {
    const scene = playSceneFromState(null, emptyGamificationStats());
    assert.equal(playStateClass(scene), "is-sleep");
  });
});
