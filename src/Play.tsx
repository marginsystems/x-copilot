import { useEffect, useState } from "react";
import { PLAY_TO_DESK_LABEL, playSceneFromState } from "./lib/play";
import {
  browserPlaySeenStorage,
  mergePlayDelta,
  takePlaySeenDelta,
  type PlayDelta,
} from "./lib/playSeen";
import { propsForState } from "./lib/playProps";
import { PlayPerch } from "./PlayPerch";
import type { CoachingState } from "./lib/coaching";
import type { GamificationStats } from "./lib/gamification";

export function PlayPage({
  onBack,
  userId,
  coaching,
  gamification,
}: {
  onBack: () => void;
  userId: string | null;
  coaching: CoachingState | null;
  gamification: GamificationStats;
}) {
  const [celebrate, setCelebrate] = useState<PlayDelta | null>(null);

  useEffect(() => {
    if (
      !userId ||
      !coaching?.dayUtc ||
      gamification.achievements.length === 0
    )
      return;
    const found = takePlaySeenDelta(
      browserPlaySeenStorage(),
      userId,
      coaching,
      gamification,
    );
    setCelebrate((current) => {
      if (!found) return current;
      if (!current) return found;
      return mergePlayDelta(current, found);
    });
  }, [userId, coaching, gamification]);

  const scene = playSceneFromState(coaching, gamification, celebrate);
  const propIds = propsForState(
    scene.missions,
    gamification.achievements,
    scene.dayUtc,
  );

  return (
    <section className="panel settings-pane play-pane">
      <div className="settings-head">
        <h2>Perch</h2>
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      </div>
      <p className="status settings-lede play-lede">
        A souvenir of the day's desk work.
      </p>
      <PlayPerch scene={scene} props={propIds} />
      {scene.state === "nudge" ? (
        <button type="button" className="ghost play-to-desk" onClick={onBack}>
          {PLAY_TO_DESK_LABEL}
        </button>
      ) : null}
      <p className="play-caption">
        Level {scene.level} · Streak {scene.currentStreak}
      </p>
      {scene.missions.length > 0 ? (
        <ul className="play-missions">
          {scene.missions.map((m) => (
            <li key={m.id}>
              {m.label} {m.progress}/{m.target}
              {m.claimed ? " · claimed" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
