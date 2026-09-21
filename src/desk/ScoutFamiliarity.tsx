import { useId } from "react";
import type { ScoutFamiliarity as ScoutFamiliarityData } from "../lib/scoutFamiliarity";
import type { ThreadKind } from "./types";

type ScoutFamiliarityProps = {
  familiarity: ScoutFamiliarityData | null;
};

const KIND_LABELS: Record<ThreadKind, string> = {
  timely_take: "timely take",
  fact_add: "fact add",
  sharp_opinion: "sharp opinion",
  lived_answer: "lived answer",
  hollow_ask: "open question",
  promo_context: "promo context",
  bare_news: "bare news",
  closed_thread: "closed thread",
  other: "other",
};

function plural(n: number, noun: string, nouns = `${noun}s`): string {
  return `${n} ${n === 1 ? noun : nouns}`;
}

/** Absolute UTC minute, never a relative interval. */
function formatLearnedAt(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Compact labelled meter beside the flight path. Shows evidence coverage and
 * supported observations only; unavailable data renders nothing at all.
 */
export function ScoutFamiliarity({ familiarity }: ScoutFamiliarityProps) {
  const titleId = useId();
  const helpId = useId();
  if (!familiarity) return null;
  const { score, coverage, state, biases, hints, lastLearned } = familiarity;
  const coverageText = `${score} of 100 coverage · ${plural(
    coverage.storedConfirmedReplies,
    "stored confirmed reply",
    "stored confirmed replies",
  )} · ${plural(coverage.knownKindResolvedActions, "known-kind resolved action")}`;

  return (
    <section className="scout-familiarity" aria-labelledby={titleId}>
      <h3 id={titleId} className="scout-familiarity-title">
        Scout familiarity
      </h3>
      <div
        className="scout-familiarity-meter"
        role="meter"
        aria-labelledby={titleId}
        aria-describedby={helpId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={score}
        aria-valuetext={coverageText}
      >
        <span className="scout-familiarity-fill" style={{ width: `${score}%` }} />
      </div>
      <p className="scout-familiarity-coverage">{coverageText}</p>
      <p id={helpId} className="scout-familiarity-help">
        Resolved actions are takes and skips with a known thread kind. This
        measures evidence coverage, not accuracy or XP.
      </p>
      {state === "empty" ? (
        <p className="scout-familiarity-state">Confirmed replies build familiarity.</p>
      ) : state === "learning" ? (
        <p className="scout-familiarity-state">Learning.</p>
      ) : null}
      {biases.length ? (
        <ul className="scout-familiarity-list" aria-label="Supported kinds">
          {biases.map((row) => (
            <li key={row.kind}>
              {row.bias === "prefer" ? "Prefer" : "Avoid"} · {KIND_LABELS[row.kind]} ·{" "}
              {plural(row.takes, "take")} · {plural(row.skips, "skip")}
            </li>
          ))}
        </ul>
      ) : null}
      {hints.length ? (
        <ul className="scout-familiarity-list" aria-label="Supported hints">
          {hints.map((row) => (
            <li key={`${row.category}:${row.value}`}>
              {row.category === "topic" ? "Topic" : "Author"} · {row.value} ·{" "}
              {plural(row.distinctTargets, "target")}
            </li>
          ))}
        </ul>
      ) : null}
      {lastLearned ? (
        <p className="scout-familiarity-last">
          Last learned: {lastLearned.action}
          {lastLearned.threadKind ? ` · ${KIND_LABELS[lastLearned.threadKind]}` : ""} ·{" "}
          {formatLearnedAt(lastLearned.at)}
        </p>
      ) : null}
    </section>
  );
}
