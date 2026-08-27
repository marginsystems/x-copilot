import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DailyMission } from "./coaching.ts";
import type { AchievementPublic } from "./gamification.ts";
import { PLAY_PROP_IDS, propsForState, type PropId } from "./playProps.ts";

const ACHIEVEMENT_CASES = [
  ["first_mark", "nameplate"],
  ["marks_10", "trophy_10"],
  ["marks_50", "trophy_50"],
  ["marks_100", "trophy_100"],
  ["marks_250", "trophy_250"],
  ["streak_3", "scarf"],
  ["streak_7", "goggles"],
  ["streak_14", "cap"],
  ["streak_30", "wing_patch"],
  ["level_5", "pennant"],
  ["level_10", "lamp_upgrade"],
  ["level_15", "window"],
  ["level_25", "second_bar"],
] as const satisfies readonly (readonly [string, PropId])[];

function mission(
  id: string,
  partial: Partial<DailyMission> = {},
): DailyMission {
  return {
    id,
    label: id,
    target: 1,
    progress: 0,
    xpReward: 1,
    completed: false,
    claimed: false,
    ...partial,
  };
}

function achievement(id: string, unlocked: boolean): AchievementPublic {
  return {
    id,
    title: id,
    detail: id,
    kind: "marks",
    threshold: 1,
    unlocked,
  };
}

describe("propsForState", () => {
  it("maps each unlocked achievement once and excludes it when locked", () => {
    for (const [sourceId, propId] of ACHIEVEMENT_CASES) {
      assert.deepEqual(
        propsForState([], [achievement(sourceId, true)], "2026-08-27"),
        [propId],
      );
      assert.deepEqual(
        propsForState([], [achievement(sourceId, false)], "2026-08-27"),
        [],
      );
    }
  });

  it("drops unknown achievement ids", () => {
    assert.deepEqual(
      propsForState([], [achievement("future_unlock", true)], "2026-08-27"),
      [],
    );
  });

  it("drops unknown mission ids", () => {
    assert.deepEqual(
      propsForState(
        [mission("future_mission", { claimed: true })],
        [],
        "2026-08-27",
      ),
      [],
    );
  });

  it("requires a claimed mission and a non-empty dayUtc", () => {
    const claimed = [
      mission("mark_2", { completed: true, claimed: true }),
      mission("original_1", { completed: true, claimed: true }),
      mission("takeoff_1", { completed: true, claimed: true }),
    ];
    assert.deepEqual(propsForState(claimed, [], "2026-08-27"), [
      "logbook",
      "postcard",
      "plane",
    ]);
    assert.deepEqual(
      propsForState(
        [mission("mark_2", { completed: true, claimed: false })],
        [],
        "2026-08-27",
      ),
      [],
    );
    assert.deepEqual(propsForState(claimed, [], ""), []);
  });

  it("maps an unlocked streak_7 achievement to goggles", () => {
    assert.ok(
      propsForState([], [achievement("streak_7", true)], "").includes(
        "goggles",
      ),
    );
  });

  it("returns deterministic catalog order", () => {
    const missions = [
      mission("takeoff_1", { claimed: true }),
      mission("mark_2", { claimed: true }),
      mission("original_1", { claimed: true }),
    ];
    const achievements = [...ACHIEVEMENT_CASES]
      .reverse()
      .map(([id]) => achievement(id, true));
    const first = propsForState(missions, achievements, "2026-08-27");
    const second = propsForState(missions, achievements, "2026-08-27");

    assert.deepEqual(first, PLAY_PROP_IDS);
    assert.deepEqual(second, first);
  });

  it("does not duplicate props for duplicate inputs", () => {
    assert.deepEqual(
      propsForState(
        [
          mission("mark_2", { claimed: true }),
          mission("mark_2", { claimed: true }),
        ],
        [
          achievement("first_mark", true),
          achievement("first_mark", true),
        ],
        "2026-08-27",
      ),
      ["logbook", "nameplate"],
    );
  });

  it("stays free of DOM globals", () => {
    const source = readFileSync(new URL("./playProps.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(?:document|window)\s*(?:\.|\[)/);
  });
});
