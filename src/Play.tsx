import { playSceneFromState } from "./lib/play";
import { PlayCopilot } from "./PlayCopilot";
import type { CoachingState } from "./lib/coaching";
import type { GamificationStats } from "./lib/gamification";

export function PlayPage({
  onBack,
  coaching,
  gamification,
}: {
  onBack: () => void;
  coaching: CoachingState | null;
  gamification: GamificationStats;
}) {
  const scene = playSceneFromState(coaching, gamification);

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
      <PlayCopilot scene={scene} />
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
