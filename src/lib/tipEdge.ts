/** Align a centered tip so it stays inside the viewport. */

export type TipEdge = "start" | "center" | "end";

/** Matches .tip-chip.has-tip::after — 16rem @ 15px root font-size, capped at 76vw. */
export function estimateTipWidth(viewportWidth: number): number {
  return Math.min(16 * 15, viewportWidth * 0.76);
}

export function tipEdge(
  triggerCenterX: number,
  tipWidth: number,
  viewportWidth: number,
  pad = 12,
): TipEdge {
  const left = triggerCenterX - tipWidth / 2;
  const right = triggerCenterX + tipWidth / 2;
  const overflowLeft = left < pad;
  const overflowRight = right > viewportWidth - pad;
  const chipHalf = 8;
  if (overflowLeft && !overflowRight) {
    return triggerCenterX - chipHalf + tipWidth <= viewportWidth - pad
      ? "start"
      : "center";
  }
  if (overflowRight && !overflowLeft) {
    return triggerCenterX + chipHalf - tipWidth >= pad ? "end" : "center";
  }
  if (overflowLeft && overflowRight) {
    return triggerCenterX < viewportWidth / 2 ? "start" : "end";
  }
  return "center";
}
