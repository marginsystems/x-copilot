import { playSceneFromState } from "./lib/play";
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
      <dl className="play-facts">
        <div>
          <dt>State</dt>
          <dd>{scene.state}</dd>
        </div>
        <div>
          <dt>Perch</dt>
          <dd>{scene.perchLit ? "lit" : "dark"}</dd>
        </div>
        <div>
          <dt>Level</dt>
          <dd>{scene.level}</dd>
        </div>
        <div>
          <dt>Streak</dt>
          <dd>{scene.currentStreak}</dd>
        </div>
        <div>
          <dt>XP</dt>
          <dd>{scene.lifetimeXp}</dd>
        </div>
        <div>
          <dt>Next</dt>
          <dd>
            {scene.speech
              ? scene.speechKind
                ? `${scene.speechKind} — ${scene.speech}`
                : scene.speech
              : "—"}
          </dd>
        </div>
      </dl>
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
