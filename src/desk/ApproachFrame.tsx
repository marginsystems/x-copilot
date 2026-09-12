import type { ReactNode } from "react";
import { FYP_DETECTING_COPY } from "../lib/forYou";
import { DeskRow } from "./DeskRow";
import { FadeSwap } from "./FadeSwap";
import { ScoutTankMark } from "./ScoutTankMark";

/** In-row detect treatment. The frame never owns this copy. */
export function ApproachDetectingMark() {
  return (
    <span className="for-you-status">
      <span>{FYP_DETECTING_COPY}</span>
      <span className="approach-panel-loader-mark" aria-hidden="true" />
    </span>
  );
}

export function ApproachFrame({
  verb,
  why,
  children,
  busy = false,
  status = false,
}: {
  verb?: string;
  why?: ReactNode;
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
      {verb ? <p className="mission-card-verb">{verb}</p> : null}
      {why ? <p className="mission-card-why">{why}</p> : null}
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
    <DeskRow
      className={`approach-flight-row${flying ? " is-flying" : ""}`}
      lead={<span className="approach-flight-pulse" />}
      leadTitle="Collecting"
      summary={<FadeSwap text={line} />}
      meta={<ScoutTankMark />}
      ariaBusy={flying}
      status
    />
  );
}
