import {
  TANK_DISPLAY_FULL,
  formatPctDelta,
  formatPerHour,
  formatTankGauge,
  type DeskGaugeBand,
  type DeskInstruments,
  type InstrumentDelta,
} from "./deskInstruments";
import { niceCeil, type GaugeTone, type GaugeZone } from "./gaugeGeometry";
import { REPLY_PACE_MS } from "./replyPace";

export const REPLY_RATE_CEILING_PER_HOUR = 3_600_000 / REPLY_PACE_MS;
export const REPLY_RATE_SCALE_STEPS = [1, 2, 5, 10, 20, 30, REPLY_RATE_CEILING_PER_HOUR];
export const REPLIES_DAY_SCALE_STEPS = [10, 20, 50, 100, 200];
export const TANK_LOW_FUEL = 2;

export const INBOUND_WORD: Record<DeskGaugeBand, string> = {
  cool: "Clear",
  warm: "Mixed",
  hot: "Quiet",
};

const BAND_NEEDLE: Record<DeskGaugeBand, number> = { cool: 0.5, warm: 1.5, hot: 2.5 };
const BAND_TONE: Record<DeskGaugeBand, GaugeTone | null> = {
  cool: null,
  warm: "warn",
  hot: "danger",
};

export type DeskGaugeId =
  | "repliesPerHour"
  | "repliesToday"
  | "ogToday"
  | "postsPerDay"
  | "tank"
  | "inbound";

export type DeskGaugeSpec = {
  id: DeskGaugeId;
  label: string;
  unit: string;
  valueText: string;
  value: number | null;
  min: number;
  max: number;
  zones: GaugeZone[];
  tone?: GaugeTone | null;
  majorSegments: number;
  minorPerSegment: number;
  tickLabels: Array<{ fraction: number; text: string }>;
  showFill: boolean;
  delta?: InstrumentDelta;
  note: string;
};

export function replyRateScaleMax(ratePerHour: number): number {
  return niceCeil(ratePerHour, REPLY_RATE_SCALE_STEPS);
}

export function repliesDayScaleMax(replies: number): number {
  return niceCeil(replies, REPLIES_DAY_SCALE_STEPS);
}

export function formatScaleLabel(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function edgeAndMidLabels(max: number): Array<{ fraction: number; text: string }> {
  return [
    { fraction: 0, text: "0" },
    { fraction: 0.5, text: formatScaleLabel(max / 2) },
    { fraction: 1, text: formatScaleLabel(max) },
  ];
}

export function deltaSpoken(pct: number | null, label: string): string {
  const text = formatPctDelta(pct);
  if (pct === null) return `new over ${label}`;
  if (pct > 0) return `up ${text} over ${label}`;
  if (pct < 0) return `down ${text} over ${label}`;
  return `unchanged over ${label}`;
}

export function gaugeValueText(spec: DeskGaugeSpec): string {
  const parts = [`${spec.valueText} ${spec.unit}`];
  if (spec.delta) {
    parts.push(deltaSpoken(spec.delta.pct24h, "24h"), deltaSpoken(spec.delta.pct7d, "7d"));
  }
  return parts.join(", ");
}

export function deskGaugeSpecs(g: DeskInstruments): DeskGaugeSpec[] {
  const rateMax = replyRateScaleMax(g.repliesPerHour);
  const dayMax = repliesDayScaleMax(g.repliesUtcDay);
  const cap = Math.max(1, g.dailyPostCap);
  const band = g.inboundBand;
  return [
    {
      id: "repliesPerHour",
      label: "Replies / hour",
      unit: "replies per hour",
      valueText: formatPerHour(g.repliesPerHour),
      value: g.repliesPerHour,
      min: 0,
      max: rateMax,
      zones: [],
      majorSegments: 2,
      minorPerSegment: 4,
      tickLabels: edgeAndMidLabels(rateMax),
      showFill: true,
      delta: g.repliesPerHourDelta,
      note: "Last 500 marks on this desk, as a real hourly rate.",
    },
    {
      id: "repliesToday",
      label: "Replies today",
      unit: "replies this UTC day",
      valueText: String(g.repliesUtcDay),
      value: g.repliesUtcDay,
      min: 0,
      max: dayMax,
      zones: [],
      majorSegments: 2,
      minorPerSegment: 4,
      tickLabels: edgeAndMidLabels(dayMax),
      showFill: true,
      delta: g.repliesUtcDayDelta,
      note: "Marks this UTC day.",
    },
    {
      id: "ogToday",
      label: "OG today",
      unit: `originals this UTC day, cap ${cap}`,
      valueText: String(g.originalsToday),
      value: g.originalsToday,
      min: 0,
      max: cap,
      zones: [],
      majorSegments: 2,
      minorPerSegment: 4,
      tickLabels: edgeAndMidLabels(cap),
      showFill: true,
      delta: g.originalsTodayDelta,
      note: "Originals this UTC day. Not quotes, not replies.",
    },
    {
      id: "postsPerDay",
      label: "Posts / day",
      unit: `posts of ${cap} allowed today`,
      valueText: `${g.postsToday} / ${g.dailyPostCap}`,
      value: g.postsToday,
      min: 0,
      max: cap,
      zones: cap > 1 ? [{ from: cap - 1, to: cap, tone: "warn" }] : [],
      tone: BAND_TONE[g.postsBand],
      majorSegments: 2,
      minorPerSegment: 4,
      tickLabels: edgeAndMidLabels(cap),
      showFill: true,
      delta: g.postsTodayDelta,
      note: "Cap comes from level and streak. Streak is a UTC day with an original, reply, or quote — on or off the desk. Likes and follows do not count.",
    },
    {
      id: "tank",
      label: "Tank",
      unit: "usable scouted replies",
      valueText: formatTankGauge(g.tankCount),
      value: g.tankCount,
      min: 0,
      max: TANK_DISPLAY_FULL,
      zones: [{ from: 0, to: TANK_LOW_FUEL, tone: "danger" }],
      majorSegments: 2,
      minorPerSegment: 4,
      tickLabels: [
        { fraction: 0, text: "E" },
        { fraction: 1, text: "F" },
      ],
      showFill: true,
      note: "Usable scouted replies on this desk.",
    },
    {
      id: "inbound",
      label: "Inbound quiet",
      unit: "inbound reply activity",
      valueText: band === null ? "–" : INBOUND_WORD[band],
      value: band === null ? null : BAND_NEEDLE[band],
      min: 0,
      max: 3,
      zones: [
        { from: 0, to: 1, tone: "gain" },
        { from: 1, to: 2, tone: "warn" },
        { from: 2, to: 3, tone: "danger" },
      ],
      tone: band === null ? null : BAND_TONE[band],
      majorSegments: 3,
      minorPerSegment: 0,
      tickLabels: [],
      showFill: false,
      note: "Desk theory from sampled reply stats, not an official X signal.",
    },
  ];
}
