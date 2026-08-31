import { useId } from "react";
import type { ActivityBucket, ActivityStats } from "../lib/activityStats";
import type { GamificationStats } from "../lib/gamification";
import { ActivityStrip } from "./ActivityStrip";
import { FadeSwap } from "./FadeSwap";

type DeskTopProps = {
  open: boolean;
  onToggle: () => void;
  searching: boolean;
  status: string;
  flightPathOpen: boolean;
  activityBucket: ActivityBucket;
  activityStats: ActivityStats;
  gamification: GamificationStats;
  onToggleFlightPath: () => void;
  onActivityBucket: (bucket: ActivityBucket) => void;
};

export function DeskTop({
  open,
  onToggle,
  searching,
  status,
  flightPathOpen,
  activityBucket,
  activityStats,
  gamification,
  onToggleFlightPath,
  onActivityBucket,
}: DeskTopProps) {
  const bodyId = useId();
  const statusLine = status || "Scout refuels when Approach is empty.";

  return (
    <div className={open ? "desk-top" : "desk-top is-collapsed"}>
      <div className="desk-top-bar">
        {open ? (
          <p className="desk-top-bar-title">Flight path</p>
        ) : (
          <div className="desk-top-bar-copy" aria-live="polite">
            <p className={searching ? "status scout-flight-line" : "status status-main"}>
              <FadeSwap text={statusLine} />
            </p>
          </div>
        )}
        <button
          type="button"
          className="desk-top-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Minimize flight path" : "Expand flight path"}
          onClick={onToggle}
        >
          <span className="desk-top-caret" aria-hidden="true">
            {open ? "–" : "+"}
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
          <div className="desk-top-body-content">
            <ActivityStrip
              flightPathOpen={flightPathOpen}
              activityBucket={activityBucket}
              activityStats={activityStats}
              gamification={gamification}
              onToggleFlightPath={onToggleFlightPath}
              onActivityBucket={onActivityBucket}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
