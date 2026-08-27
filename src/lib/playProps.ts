/**
 * Map coaching + gamification state to /play souvenir props.
 * Kept free of DOM so it can run under node:test.
 */

import type { DailyMission } from "./coaching";
import type { AchievementPublic } from "./gamification";

export const PLAY_PROP_IDS = [
  "logbook",
  "postcard",
  "plane",
  "nameplate",
  "trophy_10",
  "trophy_50",
  "trophy_100",
  "trophy_250",
  "scarf",
  "goggles",
  "cap",
  "wing_patch",
  "pennant",
  "lamp_upgrade",
  "window",
  "second_bar",
] as const;

export type PropId = (typeof PLAY_PROP_IDS)[number];

const MISSION_PROPS = [
  ["mark_2", "logbook"],
  ["original_1", "postcard"],
  ["takeoff_1", "plane"],
] as const satisfies readonly (readonly [string, PropId])[];

const ACHIEVEMENT_PROPS = [
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

export function propsForState(
  missions: DailyMission[],
  achievements: AchievementPublic[],
  dayUtc: string,
): PropId[] {
  const props: PropId[] = [];

  if (dayUtc.length > 0) {
    const claimedMissionIds = new Set(
      missions.filter((mission) => mission.claimed).map((mission) => mission.id),
    );
    for (const [sourceId, propId] of MISSION_PROPS) {
      if (claimedMissionIds.has(sourceId)) props.push(propId);
    }
  }

  const unlockedAchievementIds = new Set(
    achievements
      .filter((achievement) => achievement.unlocked)
      .map((achievement) => achievement.id),
  );
  for (const [sourceId, propId] of ACHIEVEMENT_PROPS) {
    if (unlockedAchievementIds.has(sourceId)) props.push(propId);
  }

  return props;
}
