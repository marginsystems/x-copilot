/** Keep in sync with 10-scout.css fade-swap animations. */
export const FADE_SWAP_MS = 380;

const HOLD_SHORT = /^Hold short \d+s\.?$/;

/** Same sentence with only a trailing 4 or 4/20 count. */
function flightBase(text: string): string {
  return text.replace(/\s+\d+(?:\/\d+)?\s*$/, "");
}

/** Animate stage copy. Leave hold-short and live counts instant. */
export function fadeSwapShouldAnimate(prev: string, next: string): boolean {
  if (prev === next) return false;
  if (HOLD_SHORT.test(prev) && HOLD_SHORT.test(next)) return false;
  return flightBase(prev) !== flightBase(next);
}
