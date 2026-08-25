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

/** Flip a tip below the anchor when it would clip the top of the viewport. */
export function tipFlipBelow(
  triggerY: number,
  tipHeight: number,
  pad = 12,
  gap = 10,
): boolean {
  return triggerY - tipHeight - gap < pad;
}

/** Map a point's viewBox coordinates to fixed viewport coordinates. */
export function tipAnchor(
  boxLeft: number,
  boxTop: number,
  boxWidth: number,
  boxHeight: number,
  pointX: number,
  pointY: number,
  chartWidth: number,
  chartHeight: number,
): { x: number; y: number } {
  return {
    x: boxLeft + (pointX / chartWidth) * boxWidth,
    y: boxTop + (pointY / chartHeight) * boxHeight,
  };
}
