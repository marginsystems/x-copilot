import {
  missionFillPct,
  nextActionKindClass,
  nextActionKindLabel,
  nextActionKindShort,
  nextActionProgress,
  type CoachingState,
  type DailyMission,
  type NextActionKind,
} from "../lib/coaching";

function progressNoun(kind: NextActionKind): string {
  if (kind === "original") return "originals today";
  if (kind === "takeoff") return "takeoffs today";
  return "replies today";
}

function DeskMeter(props: {
  current: number;
  target: number;
  label: string;
  noun: string;
}) {
  const done = props.current >= props.target;
  return (
    <span
      className={done ? "desk-meter is-done" : "desk-meter"}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={props.target}
      aria-valuenow={props.current}
      aria-label={`${props.current} of ${props.target} ${props.noun}`}
    >
      <span className="desk-meter-track">
        <span
          className="desk-meter-fill"
          style={{ width: `${missionFillPct(props.current, props.target)}%` }}
        />
      </span>
      <span className="desk-meter-count">{props.label}</span>
    </span>
  );
}

function missionNoun(mission: DailyMission): string {
  if (mission.id === "original_1") return "originals today";
  if (mission.id === "takeoff_1") return "takeoffs today";
  return "replies today";
}

export function NextActionRow({ coaching }: { coaching: CoachingState }) {
  const action = coaching.nextAction;
  if (!action) return null;
  const kindClass = nextActionKindClass(action.kind);
  const progress = nextActionProgress(action, coaching.missions);
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
            {progress ? (
              <DeskMeter
                current={progress.current}
                target={progress.target}
                label={progress.label}
                noun={progressNoun(action.kind)}
              />
            ) : null}
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
          <span className="row-meta daily-missions-meta">
            {coaching.missions.map((m) => (
              <span
                key={m.id}
                className={
                  m.completed ? "chip daily-mission is-done" : "chip daily-mission"
                }
              >
                <span className="daily-mission-copy">
                  {m.label}
                  {m.claimed ? ` · +${m.xpReward} XP` : ` · ${m.xpReward} XP`}
                </span>
                <DeskMeter
                  current={m.progress}
                  target={m.target}
                  label={`${m.progress}/${m.target}`}
                  noun={missionNoun(m)}
                />
              </span>
            ))}
          </span>
        </span>
      </div>
    </article>
  );
}
