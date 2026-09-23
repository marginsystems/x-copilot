import { SCOUT_TANK_LABEL, SCOUT_TANK_TITLE } from "../lib/scoutTank";

export function ScoutTankMark() {
  return (
    <span className="chip chip-scout-tank" title={SCOUT_TANK_TITLE}>
      <ScoutTankIcon />
      {SCOUT_TANK_LABEL}
    </span>
  );
}

function ScoutTankIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="8" width="16" height="11" rx="2.5" />
      <polyline points="8,8 8,5 14,5 16,8" />
      <line x1="10" y1="5" x2="10" y2="3.5" />
      <line x1="10" y1="3.5" x2="15" y2="3.5" />
      <line x1="15" y1="3.5" x2="15" y2="5.5" />
    </svg>
  );
}
