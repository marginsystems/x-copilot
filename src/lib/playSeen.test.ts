import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CoachingState, DailyMission } from "./coaching.ts";
import {
  emptyGamificationStats,
  type AchievementPublic,
  type GamificationStats,
} from "./gamification.ts";
import {
  memoryPlaySeenStorage,
  mergePlayDelta,
  playSeenKey,
  takePlaySeenDelta,
} from "./playSeen.ts";

function mission(
  partial: Partial<DailyMission> & Pick<DailyMission, "id">,
): DailyMission {
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

function achievement(
  id: string,
  title: string,
  unlocked: boolean,
): AchievementPublic {
  return {
    id,
    title,
    detail: title,
    kind: "marks",
    threshold: 1,
    unlocked,
  };
}

function coaching(partial: Partial<CoachingState> = {}): CoachingState {
  return {
    dayUtc: "2026-08-27",
    nextAction: null,
    missions: [
      mission({
        id: "mark_2",
        label: "Mark 2 replies",
        target: 2,
        xpReward: 4,
      }),
    ],
    ...partial,
  };
}

function stats(partial: Partial<GamificationStats> = {}): GamificationStats {
  return { ...emptyGamificationStats(), ...partial };
}

describe("takePlaySeenDelta", () => {
  it("does not celebrate history on the first visit", () => {
    const store = memoryPlaySeenStorage();
    const delta = takePlaySeenDelta(
      store,
      "u1",
      coaching({
        missions: [
          mission({
            id: "mark_2",
            label: "Mark 2 replies",
            progress: 2,
            claimed: true,
            xpReward: 4,
          }),
        ],
      }),
      stats({
        level: 10,
        lastMarkUtcDay: "2026-08-27",
        achievements: [achievement("first_mark", "First reply", true)],
      }),
    );
    assert.equal(delta, null);
    assert.ok(store.getItem(playSeenKey("u1")));
  });

  it("celebrates a claim flip once, then goes quiet", () => {
    const store = memoryPlaySeenStorage();
    const before = coaching();
    const after = coaching({
      missions: [
        mission({
          id: "mark_2",
          label: "Mark 2 replies",
          progress: 2,
          claimed: true,
          xpReward: 4,
        }),
      ],
    });
    const g = stats();
    assert.equal(takePlaySeenDelta(store, "u1", before, g), null);
    const first = takePlaySeenDelta(store, "u1", after, g);
    assert.deepEqual(first, {
      kind: "mission",
      line: "Mark 2 replies · +4 XP",
    });
    assert.equal(takePlaySeenDelta(store, "u1", after, g), null);
  });

  it("resets mission cursor on day rollover but keeps achievements", () => {
    const store = memoryPlaySeenStorage();
    const yesterday = coaching({
      dayUtc: "2026-08-26",
      missions: [
        mission({
          id: "mark_2",
          label: "Mark 2 replies",
          claimed: true,
          xpReward: 4,
        }),
      ],
    });
    const unlocked = [
      achievement("first_mark", "First reply", true),
    ];
    takePlaySeenDelta(
      store,
      "u1",
      yesterday,
      stats({ lastMarkUtcDay: "2026-08-26", achievements: unlocked }),
    );

    const todayQuiet = takePlaySeenDelta(
      store,
      "u1",
      coaching({
        dayUtc: "2026-08-27",
        missions: [mission({ id: "mark_2", label: "Mark 2 replies" })],
      }),
      stats({ achievements: unlocked }),
    );
    assert.equal(todayQuiet, null);

    const todayClaim = takePlaySeenDelta(
      store,
      "u1",
      coaching({
        dayUtc: "2026-08-27",
        missions: [
          mission({
            id: "mark_2",
            label: "Mark 2 replies",
            claimed: true,
            xpReward: 4,
          }),
        ],
      }),
      stats({ achievements: unlocked }),
    );
    assert.equal(todayClaim?.kind, "mission");
  });

  it("falls back silent on corrupted JSON", () => {
    const store = memoryPlaySeenStorage({
      [playSeenKey("u1")]: "{not-json",
    });
    const delta = takePlaySeenDelta(
      store,
      "u1",
      coaching({
        missions: [
          mission({ id: "mark_2", label: "Mark 2 replies", claimed: true }),
        ],
      }),
      stats({ level: 4 }),
    );
    assert.equal(delta, null);
  });

  it("celebrates first mark of the day after a seeded visit", () => {
    const store = memoryPlaySeenStorage();
    takePlaySeenDelta(store, "u1", coaching(), stats());
    const delta = takePlaySeenDelta(
      store,
      "u1",
      coaching(),
      stats({ lastMarkUtcDay: "2026-08-27" }),
    );
    assert.deepEqual(delta, { kind: "mark", line: "Marked today" });
  });

  it("prefers a level-up line over a mark", () => {
    const store = memoryPlaySeenStorage();
    takePlaySeenDelta(store, "u1", coaching(), stats({ level: 4 }));
    const delta = takePlaySeenDelta(
      store,
      "u1",
      coaching(),
      stats({
        level: 5,
        lastMarkUtcDay: "2026-08-27",
        achievements: [achievement("level_5", "Scout", true)],
      }),
    );
    assert.equal(delta?.kind, "level");
    assert.equal(delta?.line, "Level 5 — Scout");
  });

  it("returns no delta when nothing changed", () => {
    const store = memoryPlaySeenStorage();
    const c = coaching();
    const g = stats();
    takePlaySeenDelta(store, "u1", c, g);
    assert.equal(takePlaySeenDelta(store, "u1", c, g), null);
  });
});

describe("mergePlayDelta", () => {
  it("keeps a pending level-up over a later mission claim", () => {
    const merged = mergePlayDelta(
      { kind: "mission", line: "Mark 2 replies · +4 XP" },
      { kind: "level", line: "Level 5 — Scout" },
    );
    assert.deepEqual(merged, { kind: "level", line: "Level 5 — Scout" });
  });

  it("keeps the pending delta when the later arrival is lower priority", () => {
    const merged = mergePlayDelta(
      { kind: "level", line: "Level 5" },
      { kind: "mark", line: "Marked today" },
    );
    assert.deepEqual(merged, { kind: "level", line: "Level 5" });
  });

  it("keeps a pending achievement over a later mark", () => {
    const merged = mergePlayDelta(
      { kind: "mark", line: "Marked today" },
      { kind: "achievement", line: "Scout unlocked" },
    );
    assert.equal(merged.kind, "achievement");
  });

  it("prefers the newer arrival on a priority tie", () => {
    const merged = mergePlayDelta(
      { kind: "mission", line: "Mark 2 replies · +4 XP" },
      { kind: "mission", line: "Post a reply · +6 XP" },
    );
    assert.deepEqual(merged, { kind: "mission", line: "Post a reply · +6 XP" });
  });
});
