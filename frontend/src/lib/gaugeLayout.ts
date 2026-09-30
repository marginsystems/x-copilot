import { GAUGE_END_DEG, GAUGE_START_DEG, polarPoint } from "./gaugeGeometry";

export const DIAL_VIEW_WIDTH = 100;
export const DIAL_VIEW_HEIGHT = 88;
export const DIAL_CX = 50;
export const DIAL_CY = 42;
export const DIAL_R_BEZEL = 40;
export const DIAL_R_ZONE = 36;
export const DIAL_R_TRACK = 30;
export const DIAL_R_TICK_OUT = 26.5;
export const DIAL_R_TICK_MAJOR_IN = 22;
export const DIAL_R_TICK_MINOR_IN = 24.5;
export const DIAL_NEEDLE_LEN = 22;
export const DIAL_NEEDLE_TAIL = 4;
export const DIAL_NEEDLE_STROKE = 1.6;
export const DIAL_HUB_RADIUS = 2.6;
export const DIAL_LABEL_DROP = 7;
export const DIAL_VALUE_BASELINE = 82;
export const DIAL_VALUE_FONT = 13;
export const DIAL_VALUE_GLYPH = 0.62;

export type Box = { left: number; top: number; right: number; bottom: number };

export function valueTextBox(text: string, fontSize = DIAL_VALUE_FONT): Box {
  const width = Array.from(text).length * fontSize * DIAL_VALUE_GLYPH;
  return {
    left: DIAL_CX - width / 2,
    right: DIAL_CX + width / 2,
    top: DIAL_VALUE_BASELINE - fontSize * 0.8,
    bottom: DIAL_VALUE_BASELINE + fontSize * 0.2,
  };
}

function segmentHitsBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: Box,
  pad: number,
): boolean {
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    if (
      x >= box.left - pad &&
      x <= box.right + pad &&
      y >= box.top - pad &&
      y <= box.bottom + pad
    ) {
      return true;
    }
  }
  return false;
}

export function needleTouchesBox(deg: number, box: Box): boolean {
  const tip = polarPoint(DIAL_CX, DIAL_CY, DIAL_NEEDLE_LEN, deg);
  const tail = polarPoint(DIAL_CX, DIAL_CY, -DIAL_NEEDLE_TAIL, deg);
  const pad = DIAL_NEEDLE_STROKE / 2;
  return segmentHitsBox(tail, tip, box, pad) || hubTouchesBox(box);
}

export function hubTouchesBox(box: Box): boolean {
  const nearestX = Math.max(box.left, Math.min(DIAL_CX, box.right));
  const nearestY = Math.max(box.top, Math.min(DIAL_CY, box.bottom));
  const dx = DIAL_CX - nearestX;
  const dy = DIAL_CY - nearestY;
  return dx * dx + dy * dy <= DIAL_HUB_RADIUS * DIAL_HUB_RADIUS;
}

export function sweptNeedleTouchesBox(box: Box, stepDeg = 1): boolean {
  for (let deg = GAUGE_START_DEG; deg <= GAUGE_END_DEG; deg += stepDeg) {
    if (needleTouchesBox(deg, box)) return true;
  }
  return needleTouchesBox(GAUGE_END_DEG, box);
}

export function arcLabelPoint(deg: number): { x: number; y: number } {
  const end = polarPoint(DIAL_CX, DIAL_CY, DIAL_R_TRACK, deg);
  return { x: end.x, y: end.y + DIAL_LABEL_DROP };
}
