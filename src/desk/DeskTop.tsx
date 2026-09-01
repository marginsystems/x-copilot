import { useId, useState } from "react";
import type { ActivityBucket, ActivityStats } from "../lib/activityStats";
import type { GamificationStats } from "../lib/gamification";
import { ActivityStrip } from "./ActivityStrip";
import { FadeSwap } from "./FadeSwap";
import { InstrumentsPanel } from "./InstrumentsPanel";
import type { InteractionHistoryEntry } from "./types";

type DeskTab = "path" | "instruments";

type DeskTopProps = {
  open: boolean;
  onToggle: () => void;
  searching: boolean;
  status: string;
  flightPathOpen: boolean;
  activityBucket: ActivityBucket;
  activityStats: ActivityStats;
  gamification: GamificationStats;
  interactedHistory: InteractionHistoryEntry[];
  postsToday?: number;
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
  interactedHistory,
  postsToday,
  onToggleFlightPath,
  onActivityBucket,
}: DeskTopProps) {
  const bodyId = useId();
  const [tab, setTab] = useState<DeskTab>("path");
  const statusLine = status || "Scout refuels when Approach is empty.";

  return (
    <div className={open ? "desk-top" : "desk-top is-collapsed"}>
      <div className="desk-top-bar">
        {open ? (
          <div
            className="desk-top-tabs"
            role="group"
            aria-label="Desk panel"
          >
            <button
              type="button"
              className={
                tab === "path" ? "threads-tab active" : "threads-tab"
              }
              aria-pressed={tab === "path"}
              onClick={() => setTab("path")}
            >
              Flight path
            </button>
            <button
              type="button"
              className={
                tab === "instruments"
                  ? "threads-tab active"
                  : "threads-tab"
              }
              aria-pressed={tab === "instruments"}
              onClick={() => setTab("instruments")}
            >
              Instruments
            </button>
          </div>
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
          aria-label={open ? "Minimize desk panel" : "Expand desk panel"}
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
            {tab === "path" ? (
              <ActivityStrip
                flightPathOpen={flightPathOpen}
                activityBucket={activityBucket}
                activityStats={activityStats}
                gamification={gamification}
                onToggleFlightPath={onToggleFlightPath}
                onActivityBucket={onActivityBucket}
              />
            ) : (
              <InstrumentsPanel
                expanded={flightPathOpen}
                interactedHistory={interactedHistory}
                gamification={gamification}
                postsToday={postsToday}
                onToggleExpand={onToggleFlightPath}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
