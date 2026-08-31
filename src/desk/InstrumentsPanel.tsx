import { useEffect, useMemo, useState } from "react";
import {
  dailyPostCap,
  DESK_GAUGE_LABEL,
  markFromHistory,
  readDeskInstruments,
  type DeskGaugeBand,
} from "../lib/deskInstruments";
import type { GamificationStats } from "../lib/gamification";
import { readReplyPaceUntil } from "./replyPaceStore";
import type { InteractionHistoryEntry } from "./types";

type InstrumentsPanelProps = {
  expanded: boolean;
  interactedHistory: InteractionHistoryEntry[];
  gamification: GamificationStats;
  onToggleExpand: () => void;
};

const TICK_MS = 1_000;

const INBOUND_WORD: Record<DeskGaugeBand, string> = {
  cool: "Clear",
  warm: "Mixed",
  hot: "Quiet",
};

function formatMedian(median: number): string {
  return Number.isInteger(median) ? String(median) : median.toFixed(1);
}

export function InstrumentsPanel({
  expanded,
  interactedHistory,
  gamification,
  onToggleExpand,
}: InstrumentsPanelProps) {
  const marks = useMemo(
    () => interactedHistory.map(markFromHistory),
    [interactedHistory],
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const gauges = readDeskInstruments({
    nowMs,
    marks,
    postsToday: 0,
    dailyPostCap: dailyPostCap({
      level: gamification.level,
      currentStreak: gamification.currentStreak,
    }),
    replyPaceUntil: readReplyPaceUntil(),
  });

  return (
    <div
      className={
        expanded ? "desk-instruments" : "desk-instruments is-collapsed"
      }
      aria-label="Instruments"
    >
      <div className="desk-instruments-head">
        <button
          type="button"
          className="threads-activity-toggle-path"
          aria-expanded={expanded}
          aria-label={
            expanded ? "Collapse instruments" : "Expand instruments"
          }
          onClick={onToggleExpand}
        >
          <span className="desk-instruments-kicker">
            {DESK_GAUGE_LABEL}s
          </span>
          <span className="threads-activity-caret" aria-hidden="true">
            {expanded ? "–" : "+"}
          </span>
        </button>
        {expanded ? (
          <span className="threads-activity-sub">
            Read from this desk&apos;s mark ledger only.
          </span>
        ) : null}
      </div>
      <div className="desk-gauges">
        <Gauge
          label="Replies / minute"
          value={gauges.repliesLast60s}
          band={gauges.minuteBand}
          note={
            gauges.minuteBand === "hot"
              ? "Two or more inside a minute. Ease off."
              : "Cool under two a minute."
          }
        />
        {gauges.hourBand !== null && gauges.hourMedian !== null ? (
          <Gauge
            label="Replies / hour"
            value={gauges.repliesLastHour}
            band={gauges.hourBand}
            note={`Your usual hour holds around ${formatMedian(gauges.hourMedian)}.`}
          />
        ) : null}
        <Gauge
          label="Replies today"
          value={gauges.repliesUtcDay}
          band={null}
          note="Marks this UTC day."
        />
        <Gauge
          label="Posts / day"
          value={`${gauges.postsToday} / ${gauges.dailyPostCap}`}
          band={gauges.postsBand}
          note="Cap comes from level and streak. Desk originals are not on the mark ledger."
        />
        {gauges.inboundBand !== null ? (
          <Gauge
            label="Inbound quiet"
            value={INBOUND_WORD[gauges.inboundBand]}
            band={gauges.inboundBand}
            note="Desk theory from sampled reply stats, not an official X signal."
          />
        ) : null}
      </div>
    </div>
  );
}

function Gauge({
  label,
  value,
  band,
  note,
}: {
  label: string;
  value: string | number;
  band: DeskGaugeBand | null;
  note: string;
}) {
  const className =
    band === "hot"
      ? "desk-gauge is-hot"
      : band === "warm"
        ? "desk-gauge is-warm"
        : "desk-gauge";
  return (
    <div className={className}>
      <span className="desk-gauge-label">{label}</span>
      <span className="desk-gauge-value">{value}</span>
      <span className="desk-gauge-note">{note}</span>
    </div>
  );
}
