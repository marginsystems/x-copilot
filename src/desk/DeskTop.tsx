import { useId } from "react";
import { AGENDA_MAX_CHARS } from "../lib/agendaPersist";
import type { ActivityBucket, ActivityStats } from "../lib/activityStats";
import type { GamificationStats } from "../lib/gamification";
import { ScoutPixelField } from "../ScoutPixelField";
import { ActivityStrip } from "./ActivityStrip";
import { FadeSwap } from "./FadeSwap";

type DeskTopProps = {
  open: boolean;
  onToggle: () => void;
  agenda: string;
  onAgendaChange: (value: string) => void;
  onAgendaBlur: () => void;
  searching: boolean;
  searchBlocked: boolean;
  grounded: boolean;
  searchCooldownRemaining: number;
  status: string;
  groundedLine: string | null;
  takeoffsLeft: number | null;
  showTakeoffsLeft: boolean;
  showUsageCta: boolean;
  onSearch: () => void;
  onStopScout: () => void;
  onFlushAgenda: () => void;
  onOpenUsage: () => void;
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
  agenda,
  onAgendaChange,
  onAgendaBlur,
  searching,
  searchBlocked,
  grounded,
  searchCooldownRemaining,
  status,
  groundedLine,
  takeoffsLeft,
  showTakeoffsLeft,
  showUsageCta,
  onSearch,
  onStopScout,
  onFlushAgenda,
  onOpenUsage,
  flightPathOpen,
  activityBucket,
  activityStats,
  gamification,
  onToggleFlightPath,
  onActivityBucket,
}: DeskTopProps) {
  const bodyId = useId();
  const takeoffLabel = grounded
    ? "Grounded"
    : searchCooldownRemaining > 0
      ? `Hold short ${searchCooldownRemaining}s`
      : "Take off";
  const statusLine =
    groundedLine ??
    (searchCooldownRemaining > 0 && !searching
      ? `Hold short ${searchCooldownRemaining}s.`
      : status || "On the ground — set an agenda and take off.");
  const takeoffsHint =
    showTakeoffsLeft && takeoffsLeft != null
      ? `${takeoffsLeft} takeoff${takeoffsLeft === 1 ? "" : "s"} left today`
      : null;

  function runTakeoff() {
    onFlushAgenda();
    onSearch();
  }

  return (
    <div className={open ? "desk-top" : "desk-top is-collapsed"}>
      <div className="desk-top-bar">
        {open ? (
          <p className="desk-top-bar-title">Agenda & flight path</p>
        ) : (
          <>
            {searching ? (
              <button
                type="button"
                className="primary scout-run desk-top-takeoff"
                onClick={onStopScout}
              >
                Land
              </button>
            ) : (
              <button
                type="button"
                className="primary scout-run desk-top-takeoff"
                disabled={searchBlocked || !agenda.trim()}
                onClick={runTakeoff}
              >
                {takeoffLabel}
              </button>
            )}
            <div className="desk-top-bar-copy" aria-live="polite">
              <p className={searching ? "status scout-flight-line" : "status status-main"}>
                <FadeSwap text={statusLine} />
              </p>
              {showUsageCta ? (
                <p className="status status-hint">
                  <button
                    type="button"
                    className="usage-cta"
                    onClick={onOpenUsage}
                  >
                    Open Usage & Billing
                  </button>
                </p>
              ) : takeoffsHint ? (
                <p className="status status-hint">{takeoffsHint}</p>
              ) : null}
            </div>
          </>
        )}
        <button
          type="button"
          className="desk-top-toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Minimize agenda" : "Expand agenda"}
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
            <div className="control-pane">
              <h2>Agenda</h2>
              <textarea
                className="agenda"
                value={agenda}
                maxLength={AGENDA_MAX_CHARS}
                onChange={(e) => onAgendaChange(e.target.value)}
                onBlur={onAgendaBlur}
                placeholder="What should we look for and how should we sound?"
              />
              <div className="scout-cluster">
                <div className="scout-controls">
                  {searching ? (
                    <button
                      type="button"
                      className="primary scout-run"
                      onClick={onStopScout}
                    >
                      Land
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="primary scout-run"
                      disabled={searchBlocked || !agenda.trim()}
                      onClick={runTakeoff}
                    >
                      {takeoffLabel}
                    </button>
                  )}
                </div>
                <div className="status-stack" aria-live="polite">
                  <p
                    className={
                      searching ? "status scout-flight-line" : "status status-main"
                    }
                  >
                    <FadeSwap text={statusLine} />
                  </p>
                  {showUsageCta ? (
                    <p className="status status-hint">
                      <button
                        type="button"
                        className="usage-cta"
                        onClick={onOpenUsage}
                      >
                        Open Usage & Billing
                      </button>
                    </p>
                  ) : takeoffsHint ? (
                    <p className="status status-hint">{takeoffsHint}</p>
                  ) : null}
                </div>
                <div className={searching ? "scout-strip active" : "scout-strip"}>
                  <div
                    className={searching ? "scout-bar" : "scout-bar idle"}
                    aria-hidden="true"
                  />
                </div>
              </div>
              <ScoutPixelField searching={searching} active={open} />
            </div>
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
