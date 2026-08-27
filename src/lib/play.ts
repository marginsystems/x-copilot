/**
 * Derive the /play scene from coaching + gamification.
 * Kept free of DOM so it can run under node:test.
 * Celebrate stays stubbed until the last-seen cursor (PR 4).
 */

import {
  nextActionKindLabel,
  type CoachingState,
  type DailyMission,
} from "./coaching";
import type { GamificationStats } from "./gamification";

export const PLAY_STATES = ["idle", "celebrate", "nudge", "sleep"] as const;
export type PlayCreatureState = (typeof PLAY_STATES)[number];

export type PlayScene = {
  state: PlayCreatureState;
  perchLit: boolean;
  speech: string | null;
  speechKind: string | null;
  dayUtc: string;
  level: number;
  currentStreak: number;
  lifetimeXp: number;
  claimedMissionIds: string[];
  missions: DailyMission[];
};

function noActivityToday(
  coaching: CoachingState | null,
  lastMarkUtcDay: string | null,
): boolean {
  const dayUtc = coaching?.dayUtc ?? "";
  const missions = coaching?.missions ?? [];
  const markedToday = Boolean(dayUtc) && lastMarkUtcDay === dayUtc;
  return !markedToday && missions.every((m) => m.progress === 0);
}

/**
 * CSS state modifiers for the perch scene, e.g. "is-nudge is-lit".
 * Sleep forces the lamp off regardless of perchLit. DOM-free on purpose.
 */
export function playStateClass(
  scene: Pick<PlayScene, "state" | "perchLit">,
): string {
  const lit = scene.perchLit && scene.state !== "sleep";
  return lit ? `is-${scene.state} is-lit` : `is-${scene.state}`;
}

export function playSceneFromState(
  coaching: CoachingState | null,
  gamification: GamificationStats,
): PlayScene {
  const dayUtc = coaching?.dayUtc ?? "";
  const nextAction = coaching?.nextAction ?? null;
  const missions = coaching?.missions ?? [];
  const perchLit = Boolean(dayUtc) && gamification.lastMarkUtcDay === dayUtc;

  let state: PlayCreatureState = "idle";
  if (noActivityToday(coaching, gamification.lastMarkUtcDay) && !nextAction) {
    state = "sleep";
  } else if (nextAction) {
    state = "nudge";
  }

  return {
    state,
    perchLit,
    speech: nextAction?.text ?? null,
    speechKind: nextAction ? nextActionKindLabel(nextAction.kind) : null,
    dayUtc,
    level: gamification.level,
    currentStreak: gamification.currentStreak,
    lifetimeXp: gamification.lifetimeXp,
    claimedMissionIds: missions.filter((m) => m.claimed).map((m) => m.id),
    missions,
  };
}
