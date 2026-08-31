import { useState } from "react";
import { ActivityChart } from "../ActivityChart";
import type { ActivityBucket, ActivityStats } from "../lib/activityStats";
import type { GamificationStats } from "../lib/gamification";
import { flightSharePayload, shareFlightPath } from "../lib/flightShare";

type ActivityStripProps = {
  flightPathOpen: boolean;
  activityBucket: ActivityBucket;
  activityStats: ActivityStats;
  gamification: GamificationStats;
  onToggleFlightPath: () => void;
  onActivityBucket: (bucket: ActivityBucket) => void;
};

export function ActivityStrip({
  flightPathOpen,
  activityBucket,
  activityStats,
  gamification,
  onToggleFlightPath,
  onActivityBucket,
}: ActivityStripProps) {
  const sharePayload = flightSharePayload(activityStats, gamification);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);

  async function onSharePath() {
    if (!sharePayload || sharing) return;
    setSharing(true);
    try {
      const result = await shareFlightPath(sharePayload);
      setShareNote(
        result.method === "share"
          ? "Share sheet opened."
          : result.copiedCaption
            ? "PNG saved. Caption copied."
            : "PNG saved.",
      );
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setShareNote("Could not save the path.");
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      className={
        flightPathOpen
          ? "threads-activity"
          : "threads-activity is-collapsed"
      }
      aria-label="Flight path"
    >
      <div className="threads-activity-head">
        <div className="threads-activity-copy">
          <div className="threads-activity-title-row">
            <button
              type="button"
              className="threads-activity-toggle-path"
              aria-expanded={flightPathOpen}
              aria-label={
                flightPathOpen
                  ? "Collapse flight path"
                  : "Expand flight path"
              }
              onClick={onToggleFlightPath}
            >
              <span className="threads-activity-caret" aria-hidden="true">
                {flightPathOpen ? "–" : "+"}
              </span>
            </button>
            {sharePayload ? (
              <button
                type="button"
                className="threads-activity-share"
                disabled={sharing}
                onClick={() => void onSharePath()}
                title="Share this path"
                aria-label="Share this path"
              >
                <FlightShareIcon />
              </button>
            ) : null}
          </div>
          {flightPathOpen ? (
            <span className="threads-activity-sub">
              Altitude is sampled views. Marks without a sample hold the
              last altitude.
            </span>
          ) : null}
        </div>
        <div
          className="threads-activity-toggle"
          role="group"
          aria-label="Activity bucket"
        >
          <button
            type="button"
            className={
              activityBucket === "day"
                ? "threads-tab active"
                : "threads-tab"
            }
            aria-pressed={activityBucket === "day"}
            onClick={() => onActivityBucket("day")}
          >
            Day
          </button>
          <button
            type="button"
            className={
              activityBucket === "week"
                ? "threads-tab active"
                : "threads-tab"
            }
            aria-pressed={activityBucket === "week"}
            onClick={() => onActivityBucket("week")}
          >
            Week
          </button>
        </div>
      </div>
      <div className="threads-activity-meta">
        <span className="chip chip-muted">
          {activityStats.totals.interactions} marked ·{" "}
          {activityStats.totals.views} views
        </span>
        <span
          className="chip"
          title="UTC daily streak — mark ≥1 interacted each UTC day"
        >
          Streak {gamification.currentStreak}
          {gamification.longestStreak > gamification.currentStreak
            ? ` · best ${gamification.longestStreak}`
            : ""}
        </span>
        <span
          className="chip threads-activity-level"
          title="XP from marks (+1) and 24h engagement bonuses"
        >
          Lv {gamification.level} · {gamification.lifetimeXp} XP
          <span
            className="threads-activity-xp-bar"
            aria-hidden="true"
          >
            <span
              className="threads-activity-xp-fill"
              style={{
                width: `${Math.min(
                  100,
                  (gamification.xpIntoLevel / gamification.xpToNext) *
                    100,
                )}%`,
              }}
            />
          </span>
        </span>
      </div>
      {flightPathOpen && gamification.nextGoal ? (
        <p className="threads-activity-next">
          Next: {gamification.nextGoal.title} — {gamification.nextGoal.detail}
        </p>
      ) : null}
      <div className="threads-activity-chart">
        {activityStats.totals.interactions === 0 ? (
          <p className="threads-activity-empty">
            Post a reply to start a flight path.
          </p>
        ) : (
          <ActivityChart
            series={activityStats.series}
            bucket={activityStats.bucket}
            compact={!flightPathOpen}
          />
        )}
      </div>
      <p className="threads-activity-share-status" aria-live="polite">
        {shareNote ?? ""}
      </p>
    </div>
  );
}

function FlightShareIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12.5 5.2 8.2 8 10l3.6-6.2L14 5.2" />
    </svg>
  );
}
