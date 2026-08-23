import { ActivityChart } from "../ActivityChart";
import type { ActivityBucket, ActivityStats } from "../lib/activityStats";
import type { GamificationStats } from "../lib/gamification";

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
          <button
            type="button"
            className="threads-activity-toggle-path"
            aria-expanded={flightPathOpen}
            onClick={onToggleFlightPath}
          >
            <span className="threads-activity-title">Flight path</span>
            <span className="threads-activity-caret" aria-hidden="true">
              {flightPathOpen ? "–" : "+"}
            </span>
          </button>
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
        <span className="chip">
          {activityStats.totals.interactions} marked
        </span>
        <span className="chip">
          {activityStats.totals.views} views
        </span>
        {activityStats.totals.withStats > 0 ? (
          <span className="chip chip-muted">
            {activityStats.totals.withStats} sampled
          </span>
        ) : null}
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
    </div>
  );
}
