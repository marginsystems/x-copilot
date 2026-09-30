import { useId, useState } from "react";
import type { ActivityBucket, ActivityStats } from "../lib/activityStats";
import { circleRefreshKey } from "../lib/circleShare";
import type { CoachingState } from "../lib/coaching";
import type { GamificationStats } from "../lib/gamification";
import type { ScoutFamiliarity as ScoutFamiliarityData } from "../lib/scoutFamiliarity";
import { ActivityStrip } from "./ActivityStrip";
import { CirclePanel } from "./CirclePanel";
import { FadeSwap } from "./FadeSwap";
import { InstrumentsPanel } from "./InstrumentsPanel";
import { ScoutFamiliarity } from "./ScoutFamiliarity";
import type { RetainedInteractionEntry } from "./types";

type DeskTopProps = {
  open: boolean;
  onToggle: () => void;
  activityBucket: ActivityBucket;
  activityStats: ActivityStats;
  gamification: GamificationStats;
  scoutFamiliarity?: ScoutFamiliarityData | null;
  interactedRetainedHistory: RetainedInteractionEntry[];
  usableScoutCount: number;
  coaching?: CoachingState | null;
  status?: string;
  onActivityBucket: (bucket: ActivityBucket) => void;
};

export function DeskTop({
  open,
  onToggle,
  activityBucket,
  activityStats,
  gamification,
  scoutFamiliarity = null,
  interactedRetainedHistory,
  usableScoutCount,
  coaching,
  status,
  onActivityBucket,
}: DeskTopProps) {
  const bodyId = useId();
  const [everOpened, setEverOpened] = useState(open);
  const barStatus = status || undefined;

  return (
    <div className={open ? "desk-top" : "desk-top is-collapsed"}>
      <div className="desk-top-bar">
        <h2 className="desk-top-bar-title">Cockpit</h2>
        {barStatus ? (
          <div className="desk-top-bar-copy">
            <p className="status" role="status">
              <FadeSwap text={barStatus} />
            </p>
          </div>
        ) : null}
        <button
          type="button"
          className="desk-top-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => {
            setEverOpened(true);
            onToggle();
          }}
        >
          <ToggleIcon />
          <span className="desk-top-toggle-label">
            <span>{open ? "Hide cockpit" : "Show cockpit"}</span>
            <span className="desk-top-toggle-sizer" aria-hidden="true">
              Show cockpit
            </span>
          </span>
        </button>
      </div>
      <div
        className="desk-top-body"
        id={bodyId}
        ref={(panel) => {
          if (!panel) return;
          if (open) panel.removeAttribute("inert");
          else panel.setAttribute("inert", "");
        }}
        aria-hidden={!open}
      >
        <div className="desk-top-body-inner">
          {everOpened ? (
            <div className="cockpit">
              <div className="cockpit-gauges">
                <InstrumentsPanel
                  interactedHistory={interactedRetainedHistory}
                  gamification={gamification}
                  coaching={coaching}
                  usableScoutCount={usableScoutCount}
                />
              </div>
              <div className="cockpit-circle">
                <CirclePanel
                  refreshKey={circleRefreshKey(interactedRetainedHistory)}
                />
              </div>
              <div className="cockpit-path">
                <ActivityStrip
                  activityBucket={activityBucket}
                  activityStats={activityStats}
                  gamification={gamification}
                  onActivityBucket={onActivityBucket}
                />
                <div className="cockpit-familiarity">
                  <ScoutFamiliarity familiarity={scoutFamiliarity} />
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ToggleIcon() {
  return (
    <svg
      className="desk-top-toggle-icon"
      viewBox="0 0 24 24"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
