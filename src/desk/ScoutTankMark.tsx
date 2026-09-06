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
      <path d="M5 10.5h12a3.5 3.5 0 0 1 0 7H5a3.5 3.5 0 0 1 0-7z" />
      <path d="M9.5 10.5V8h5v2.5" />
      <path d="M9 8h6" />
    </svg>
  );
}
