import {
  nextActionKindClass,
  nextActionKindLabel,
  nextActionKindShort,
  type CoachingState,
} from "../lib/coaching";

export function NextActionRow({ coaching }: { coaching: CoachingState }) {
  const action = coaching.nextAction;
  if (!action) return null;
  const kindClass = nextActionKindClass(action.kind);
  return (
    <article className={`thread-row for-you-row next-action-row ${kindClass}`}>
      <div className="row-head next-action-head">
        <span className={`bait ${kindClass}`} title={nextActionKindLabel(action.kind)}>
          {nextActionKindShort(action.kind)}
        </span>
        <span className="row-main">
          <span className="row-summary">{action.text}</span>
          <span className="row-meta">
            <span className="chip">Next</span>
            <span>{nextActionKindLabel(action.kind)}</span>
          </span>
        </span>
      </div>
    </article>
  );
}

export function DailyMissionsRow({ coaching }: { coaching: CoachingState }) {
  if (coaching.missions.length === 0) return null;
  return (
    <article className="thread-row for-you-row daily-missions-row">
      <div className="row-head next-action-head">
        <span className="bait kind-post" title="Daily missions">
          XP
        </span>
        <span className="row-main">
          <span className="row-summary">Daily missions</span>
          <span className="row-meta daily-missions-meta">
            {coaching.missions.map((m) => (
              <span
                key={m.id}
                className={
                  m.completed ? "chip daily-mission is-done" : "chip daily-mission"
                }
              >
                {m.label} {m.progress}/{m.target}
                {m.claimed ? ` · +${m.xpReward} XP` : ` · ${m.xpReward} XP`}
              </span>
            ))}
          </span>
        </span>
      </div>
    </article>
  );
}
