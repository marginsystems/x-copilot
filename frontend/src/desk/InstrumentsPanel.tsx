import { useEffect, useMemo, useState } from "react";
import type { CoachingState } from "../lib/coaching";
import { deskGaugeSpecs } from "../lib/deskGaugeSpecs";
import {
  dailyPostCap,
  markFromHistory,
  parseInstrumentTimes,
  readDeskInstruments,
} from "../lib/deskInstruments";
import type { GamificationStats } from "../lib/gamification";
import { DialGauge } from "./DialGauge";
import { readReplyPaceUntil } from "./replyPaceStore";
import type { RetainedInteractionEntry } from "./types";

type InstrumentsPanelProps = {
  interactedHistory: RetainedInteractionEntry[];
  gamification: GamificationStats;
  coaching?: CoachingState | null;
  usableScoutCount: number;
};

const TICK_MS = 15_000;

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

  const specs = deskGaugeSpecs(gauges);

  return (
    <section
      className="desk-instruments"
      aria-label="Instruments"
      title="Replies / hour counts the last 60 minutes. Arrows compare with 24h and 7d ago."
    >
      <div className="desk-gauges">
        {specs.map((spec) => (
          <DialGauge key={spec.id} spec={spec} />
        ))}
      </div>
    </section>
  );
}
