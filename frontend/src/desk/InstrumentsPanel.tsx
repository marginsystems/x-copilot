import { useEffect, useMemo, useState } from "react";
import type { CoachingState } from "../lib/coaching";
import {
  dailyPostCap,
  formatPerHour,
  formatPctDelta,
  formatTankGauge,
  markFromHistory,
  parseInstrumentTimes,
  readDeskInstruments,
  type DeskGaugeBand,
  type InstrumentDelta,
} from "../lib/deskInstruments";
import type { GamificationStats } from "../lib/gamification";
import { readReplyPaceUntil } from "./replyPaceStore";
import type { RetainedInteractionEntry } from "./types";

type InstrumentsPanelProps = {
  interactedHistory: RetainedInteractionEntry[];
  gamification: GamificationStats;
  coaching?: CoachingState | null;
  usableScoutCount: number;
};

const TICK_MS = 15_000;

const INBOUND_WORD: Record<DeskGaugeBand, string> = {
  cool: "Clear",
  warm: "Mixed",
  hot: "Quiet",
};

export function InstrumentsPanel({
  interactedHistory,
  gamification,
  coaching,
  usableScoutCount,
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
    usableScoutCount,
  });

  return (
    <section
      className="desk-instruments"
      aria-label="Instruments"
      title="Last 500 marks. Arrows are 24h and 7d."
    >
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
          note="Cap comes from level and streak. Streak is a UTC day with an original, reply, or quote — on or off the desk. Likes and follows do not count."
        />
        <Gauge
          label="Tank"
          value={formatTankGauge(gauges.tankCount)}
          band={null}
          note="Usable scouted replies on this desk."
          fillPercent={gauges.tankFillPercent}
        />
        <Gauge
          label="Inbound quiet"
          value={
            gauges.inboundBand !== null ? INBOUND_WORD[gauges.inboundBand] : "–"
          }
          band={gauges.inboundBand}
          note="Desk theory from sampled reply stats, not an official X signal."
        />
      </div>
    </section>
  );
}

function Gauge({
  label,
  value,
  band,
  note,
  delta,
  fillPercent,
}: {
  label: string;
  value: string | number;
  band: DeskGaugeBand | null;
  note: string;
  delta?: InstrumentDelta;
  fillPercent?: number;
}) {
  const className =
    band === "hot"
      ? "desk-gauge is-hot"
      : band === "warm"
        ? "desk-gauge is-warm"
        : "desk-gauge";
  return (
    <div className={className} title={note}>
      <span className="desk-gauge-label">{label}</span>
      <span className="desk-gauge-value">{value}</span>
      <span className="desk-gauge-deltas-slot">
        {delta ? <DeltaPair delta={delta} /> : null}
      </span>
      <span className="desk-gauge-track" aria-hidden="true">
        {fillPercent !== undefined ? (
          <span
            className="desk-gauge-fill"
            style={{ width: `${fillPercent}%` }}
          />
        ) : null}
      </span>
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
