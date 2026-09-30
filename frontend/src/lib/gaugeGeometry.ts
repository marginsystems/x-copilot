export const GAUGE_START_DEG = -210;
export const GAUGE_END_DEG = 30;
export const GAUGE_SWEEP_DEG = GAUGE_END_DEG - GAUGE_START_DEG;

export type GaugePoint = { x: number; y: number };

export type GaugeTone = "gain" | "warn" | "danger";

export type GaugeZone = { from: number; to: number; tone: GaugeTone };

export type GaugeTick = { deg: number; fraction: number; major: boolean };

export function gaugeFraction(
  value: number | null | undefined,
  min: number,
  max: number,
): number {
  if (value === null || value === undefined || !Number.isFinite(value)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0;
  return Math.min(1, Math.max(0, (value - min) / (max - min)));
}

export function gaugeHasValue(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

export function fractionToAngle(fraction: number): number {
  const clamped = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  return GAUGE_START_DEG + clamped * GAUGE_SWEEP_DEG;
}

export function valueToAngle(
  value: number | null | undefined,
  min: number,
  max: number,
): number {
  return fractionToAngle(gaugeFraction(value, min, max));
}

export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  deg: number,
): GaugePoint {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function arcPath(
  cx: number,
  cy: number,
  radius: number,
  fromDeg: number,
  toDeg: number,
): string {
  const start = polarPoint(cx, cy, radius, fromDeg);
  const end = polarPoint(cx, cy, radius, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg >= fromDeg ? 1 : 0;
  return `M ${round(start.x)} ${round(start.y)} A ${radius} ${radius} 0 ${large} ${sweep} ${round(end.x)} ${round(end.y)}`;
}

export function gaugeTicks(majorSegments: number, minorPerSegment: number): GaugeTick[] {
  const segments = Math.max(1, Math.floor(majorSegments));
  const minors = Math.max(0, Math.floor(minorPerSegment));
  const steps = segments * (minors + 1);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const fraction = i / steps;
    return { deg: fractionToAngle(fraction), fraction, major: i % (minors + 1) === 0 };
  });
}

export function zoneFractions(
  zones: readonly GaugeZone[],
  min: number,
  max: number,
): Array<{ from: number; to: number; tone: GaugeTone }> {
  return zones
    .map((zone) => ({
      tone: zone.tone,
      from: gaugeFraction(zone.from, min, max),
      to: gaugeFraction(zone.to, min, max),
    }))
    .filter((zone) => zone.to > zone.from);
}

export function toneAt(
  value: number | null | undefined,
  zones: readonly GaugeZone[],
): GaugeTone | null {
  if (!gaugeHasValue(value)) return null;
  const hit = zones.filter((zone) => value >= zone.from && value <= zone.to);
  return hit.length > 0 ? hit[hit.length - 1]!.tone : null;
}

export function niceCeil(
  value: number,
  steps: readonly number[],
  headroom = 1.2,
): number {
  const ordered = [...steps].sort((a, b) => a - b);
  const top = ordered[ordered.length - 1] ?? 1;
  if (!Number.isFinite(value) || value <= 0) return ordered[0] ?? 1;
  const target = value * headroom;
  return ordered.find((step) => step >= target) ?? top;
}
