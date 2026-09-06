import type { ReactNode } from "react";
import { FadeSwap } from "./FadeSwap";
import { ScoutTankMark } from "./ScoutTankMark";

export function ApproachFrame({
  verb,
  why,
  children,
  busy = false,
  status = false,
}: {
  verb: string;
  why: ReactNode;
  children: ReactNode;
  busy?: boolean;
  status?: boolean;
}) {
  return (
    <div
      className="mission-card approach-frame"
      aria-busy={busy || undefined}
      role={status ? "status" : undefined}
    >
      <p className="mission-card-verb">{verb}</p>
      <p className="mission-card-why">{why}</p>
      <div className="threads">{children}</div>
    </div>
  );
}

export function ApproachFlightRow({
  line,
  flying,
}: {
  line: string;
  flying: boolean;
}) {
  return (
    <article
      className={`thread-row approach-flight-row${flying ? " is-flying" : ""}`}
      aria-busy={flying || undefined}
      role="status"
    >
      <div className="row-head next-action-head">
        <div className="row-lead bait" aria-hidden="true">
          <span className="approach-flight-pulse" />
        </div>
        <div className="row-main">
          <div className="row-summary">
            <FadeSwap text={line} />
          </div>
          <div className="row-meta">
            <ScoutTankMark />
          </div>
        </div>
        <div className="caret" aria-hidden="true">
          +
        </div>
      </div>
    </article>
  );
}
