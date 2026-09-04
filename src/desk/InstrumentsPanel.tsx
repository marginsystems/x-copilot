import { useEffect, useMemo, useState } from "react";
import type { CoachingState } from "../lib/coaching";
import {
  dailyPostCap,
  DESK_GAUGE_LABEL,
  formatPerHour,
  formatPctDelta,
  markFromHistory,
  parseInstrumentTimes,
  readDeskInstruments,
  type DeskGaugeBand,
  type InstrumentDelta,
} from "../lib/deskInstruments";
import type { GamificationStats } from "../lib/gamification";
import { readReplyPaceUntil } from "./replyPaceStore";
import type { InteractionHistoryEntry } from "./types";

type InstrumentsPanelProps = {
  expanded: boolean;
  interactedHistory: InteractionHistoryEntry[];
  gamification: GamificationStats;
  coaching?: CoachingState | null;
  onToggleExpand: () => void;
};

const TICK_MS = 15_000;

const INBOUND_WORD: Record<DeskGaugeBand, string> = {
  cool: "Clear",
  warm: "Mixed",
  hot: "Quiet",
};

export function InstrumentsPanel({
  expanded,
  interactedHistory,
  gamification,
  coaching,
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
    replyAtMs: parseInstrumentTimes(coaching?.replyAt),
    originalAtMs: parseInstrumentTimes(coaching?.originalAt),
    postAtMs: parseInstrumentTimes(coaching?.postAt),
    postsToday: coaching?.postsToday ?? 0,
    originalsToday: coaching?.originalsToday ?? 0,
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
            Last 500 marks. Arrows are 24h and 7d.
          </span>
        ) : null}
      </div>
      <div className="desk-gauges">
        <Gauge
          label="Replies / hour"
          value={formatPerHour(gauges.repliesPerHour)}
          delta={gauges.repliesPerHourDelta}
          band={null}
          note="Last 500 marks on this desk, as a real hourly rate."
        />
        <Gauge
          label="Replies today"
          value={gauges.repliesUtcDay}
          delta={gauges.repliesUtcDayDelta}
          band={null}
          note="Marks this UTC day."
        />
        <Gauge
          label="OG today"
          value={gauges.originalsToday}
          delta={gauges.originalsTodayDelta}
          band={null}
          note="Originals this UTC day. Not quotes, not replies."
        />
        <Gauge
          label="Posts / day"
          value={`${gauges.postsToday} / ${gauges.dailyPostCap}`}
          delta={gauges.postsTodayDelta}
          band={gauges.postsBand}
          note="Cap comes from level and streak. Originals and quotes on the own-post ledger — not replies, not I posted alone."
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
  delta,
}: {
  label: string;
  value: string | number;
  band: DeskGaugeBand | null;
  note: string;
  delta?: InstrumentDelta;
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
      <span className="desk-gauge-value-row">
        <span className="desk-gauge-value">{value}</span>
        {delta ? <DeltaPair delta={delta} /> : null}
      </span>
      <span className="desk-gauge-note">{note}</span>
    </div>
  );
}

function DeltaPair({ delta }: { delta: InstrumentDelta }) {
  return (
    <span className="desk-gauge-deltas">
      <DeltaChip pct={delta.pct24h} label="24h" />
      <DeltaChip pct={delta.pct7d} label="7d" />
    </span>
  );
}

function DeltaChip({
  pct,
  label,
}: {
  pct: number | null;
  label: string;
}) {
  const dir =
    pct === null ? "new" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const arrow =
    dir === "down" ? "↓" : dir === "flat" ? "–" : "↑";
  const text = formatPctDelta(pct);
  const spoken =
    dir === "up"
      ? `up ${text} over ${label}`
      : dir === "down"
        ? `down ${text} over ${label}`
        : dir === "new"
          ? `new over ${label}`
          : `unchanged over ${label}`;
  return (
    <span className={`desk-delta is-${dir}`} aria-label={spoken}>
      <span aria-hidden="true">{arrow}</span>
      {text ? ` ${text}` : dir === "new" ? " new" : " 0%"} {label}
    </span>
  );
}
