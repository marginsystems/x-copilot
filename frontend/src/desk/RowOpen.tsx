import { REPLY_PACE_MS, replyPaceTip } from "../lib/replyPace";
import { HasTipButton, HasTipLink } from "./HasTip";

export type OpenPace = { remainingMs: number; clock: string };

const RING_RADIUS = 4.5;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

function PaceRing({ remainingMs }: { remainingMs: number }) {
  const left = Math.min(1, Math.max(0, remainingMs / REPLY_PACE_MS));
  return (
    <svg className="row-open-icon row-open-ring" viewBox="0 0 12 12" aria-hidden="true">
      <circle className="row-open-ring-track" cx="6" cy="6" r={RING_RADIUS} />
      <circle
        className="row-open-ring-fill"
        cx="6"
        cy="6"
        r={RING_RADIUS}
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - left)}
        transform="rotate(-90 6 6)"
      />
    </svg>
  );
}

function OpenArrow() {
  return (
    <svg className="row-open-icon row-open-arrow" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6 3h7v7h-1.5V5.56l-6.97 6.97-1.06-1.06 6.97-6.97H6V3Z" />
    </svg>
  );
}

export function PacedOpenButton({ label, pace }: { label: string; pace: OpenPace }) {
  return (
    <HasTipButton
      className="ghost row-open is-paced"
      aria-disabled="true"
      aria-label={`${label}, waiting between replies, ${pace.clock} left`}
      tip={replyPaceTip(pace.clock)}
      onClick={(event) => event.preventDefault()}
    >
      <span className="row-open-label">{label}</span>
      <PaceRing remainingMs={pace.remainingMs} />
    </HasTipButton>
  );
}

export function PacedIntentButton({ pace }: { pace: OpenPace }) {
  return (
    <HasTipButton
      className="ghost is-paced"
      aria-disabled="true"
      aria-label={`Open on X, waiting between replies, ${pace.clock} left`}
      tip={replyPaceTip(pace.clock)}
      onClick={(event) => event.preventDefault()}
    >
      Open on X
    </HasTipButton>
  );
}

export function ReadyOpenLink({
  href,
  label,
  tip,
  onClick,
}: {
  href: string;
  label: string;
  tip: string;
  onClick?: () => void;
}) {
  return (
    <HasTipLink
      className="ghost row-open"
      href={href}
      target="_blank"
      rel="noreferrer"
      tip={tip}
      onClick={onClick}
    >
      <span className="row-open-label">{label}</span>
      <OpenArrow />
    </HasTipLink>
  );
}
