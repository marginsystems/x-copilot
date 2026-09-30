/**
 * Flight-path share card. Preview in a modal. Post on X via intent.
 * Download is optional. Never a watermark on replies they send.
 */
import { LEGAL_ENTITY, PRODUCT_NAME } from "./legal";
import {
  formatPeriodLabel,
  postKindCounts,
  postKindTotal,
  stackBarSegments,
  viewsLineAltitude,
  type ActivityBucket,
  type ActivitySeriesPoint,
  type ActivityStats,
} from "./activityStats";
import type { GamificationStats } from "./gamification";

export const FLIGHT_SHARE_WIDTH = 1080;
export const FLIGHT_SHARE_HEIGHT = 1350;
export const FLIGHT_SHARE_SITE = "xcopilot.dev";
export const FLIGHT_SHARE_DISCLAIMER = `Built by ${LEGAL_ENTITY.replace(/\.$/, "")}. Not affiliated with X Corp.`;

export const SHARE_PALETTE = {
  bg: "#161310",
  panel: "#1f1b17",
  raised: "#26211c",
  border: "#3a332c",
  borderStrong: "#4d453c",
  grid: "rgba(244, 238, 230, 0.08)",
  text: "#f4eee6",
  muted: "#a89f94",
  faint: "#7d746a",
  accent: "#7eb8dc",
  accentWash: "rgba(126, 184, 220, 0.14)",
  original: "#6c9fc0",
  quote: "#7ea88f",
  reply: "#d4a574",
  viewsLine: "rgba(126, 184, 220, 0.6)",
  viewsFill: "rgba(126, 184, 220, 0.07)",
};
const C = SHARE_PALETTE;

export const SHARE_FONT_HEAD = '"Space Grotesk", "Segoe UI", sans-serif';
export const SHARE_FONT_BODY = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';
const FONT_HEAD = SHARE_FONT_HEAD;
const FONT_BODY = SHARE_FONT_BODY;

export type FlightAltitudePoint = {
  period: string;
  interactions: number;
  views: number;
  held: boolean;
};

export type FlightSharePayload = {
  bucket: ActivityBucket;
  series: ActivitySeriesPoint[];
  altitude: FlightAltitudePoint[];
  marked: number;
  views: number;
  streak: number;
  longestStreak: number;
  level: number;
  lifetimeXp: number;
  nextGoal: string | null;
};

export function altitudeSeries(
  points: readonly ActivitySeriesPoint[],
): FlightAltitudePoint[] {
  const out: FlightAltitudePoint[] = [];
  let last = 0;
  for (const point of points) {
    const alt = viewsLineAltitude(point, last);
    if (!alt.held) last = alt.views;
    out.push({
      period: point.period,
      interactions: point.interactions,
      views: alt.views,
      held: alt.held,
    });
  }
  return out;
}

export function flightSharePayload(
  stats: ActivityStats | null,
  gamification: GamificationStats | null,
): FlightSharePayload | null {
  if (!stats || stats.totals.interactions < 1) return null;
  const g = gamification;
  return {
    bucket: stats.bucket,
    series: stats.series,
    altitude: altitudeSeries(stats.series),
    marked: stats.totals.interactions,
    views: stats.totals.views,
    streak: g?.currentStreak ?? 0,
    longestStreak: g?.longestStreak ?? 0,
    level: g?.level ?? 1,
    lifetimeXp: g?.lifetimeXp ?? 0,
    nextGoal: g?.nextGoal
      ? `${g.nextGoal.title} — ${g.nextGoal.detail}`
      : null,
  };
}

export function flightShareFilename(payload: FlightSharePayload): string {
  return payload.bucket === "week"
    ? "xcopilot-flight-week.png"
    : "xcopilot-flight-day.png";
}

export function flightShareCaption(payload: FlightSharePayload): string {
  const window =
    payload.bucket === "week" ? "This week's flight path" : "Last 28 days on the desk";
  const streak =
    payload.streak > 0 ? `, streak ${payload.streak}` : "";
  const head = `${window} — ${payload.marked} posts, Lv ${payload.level}${streak}.`;
  return [head, "", FLIGHT_SHARE_SITE, FLIGHT_SHARE_DISCLAIMER].join("\n");
}

/** Compose intent. X cannot attach the PNG; the caption is the post. */
export function flightShareIntentUrl(payload: FlightSharePayload): string {
  const params = new URLSearchParams({ text: flightShareCaption(payload) });
  return `https://x.com/intent/tweet?${params.toString()}`;
}

export type DrawCtx = {
  fillStyle: CanvasRenderingContext2D["fillStyle"];
  strokeStyle: CanvasRenderingContext2D["strokeStyle"];
  font: string;
  textBaseline: CanvasTextBaseline;
  textAlign: CanvasTextAlign;
  lineWidth: number;
  lineJoin: CanvasLineJoin;
  lineCap: CanvasLineCap;
  fillRect: CanvasRenderingContext2D["fillRect"];
  beginPath: CanvasRenderingContext2D["beginPath"];
  closePath: CanvasRenderingContext2D["closePath"];
  fill: CanvasRenderingContext2D["fill"];
  stroke: CanvasRenderingContext2D["stroke"];
  fillText: CanvasRenderingContext2D["fillText"];
  measureText: (text: string) => { width: number };
  createLinearGradient: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => { addColorStop: (offset: number, color: string) => void };
  roundRect: CanvasRenderingContext2D["roundRect"];
  rect: CanvasRenderingContext2D["rect"];
  moveTo: CanvasRenderingContext2D["moveTo"];
  lineTo: CanvasRenderingContext2D["lineTo"];
};

export type FlightShareRect = { x: number; y: number; w: number; h: number };

export type FlightShareLayout = {
  inset: number;
  padX: number;
  contentW: number;
  titleY: number;
  kickerY: number;
  ruleY: number;
  statValueY: number;
  statLabelY: number;
  statColW: number;
  chart: FlightShareRect;
  goalY: number | null;
  footerTop: number;
  footerTextY: number;
  bottom: number;
};

const CARD_INSET = 36;
const CARD_PAD = 48;
const SECTION_GAP = 44;
const GOAL_H = 64;
const FOOTER_H = 60;
const STAT_COLUMNS = 4;

export function flightShareLayout(
  width: number,
  height: number,
  hasGoal: boolean,
): FlightShareLayout {
  const padX = CARD_INSET + CARD_PAD;
  const contentW = width - padX * 2;
  const top = CARD_INSET + CARD_PAD;
  const bottom = height - CARD_INSET - CARD_PAD;
  const kickerY = top + 66;
  const ruleY = kickerY + 34;
  const statValueY = ruleY + 36;
  const statLabelY = statValueY + 84;
  const chartY = statLabelY + 22 + SECTION_GAP;
  const footerTop = bottom - FOOTER_H;
  const goalY = hasGoal ? footerTop - SECTION_GAP - GOAL_H : null;
  const chartBottom = (goalY ?? footerTop) - SECTION_GAP;
  return {
    inset: CARD_INSET,
    padX,
    contentW,
    titleY: top,
    kickerY,
    ruleY,
    statValueY,
    statLabelY,
    statColW: contentW / STAT_COLUMNS,
    chart: { x: padX, y: chartY, w: contentW, h: chartBottom - chartY },
    goalY,
    footerTop,
    footerTextY: footerTop + 34,
    bottom,
  };
}

export type ChartBarLayout = { slot: number; barW: number; offset: number };

export function chartBarLayout(innerW: number, count: number): ChartBarLayout {
  const n = Math.max(1, count);
  const slot = Math.max(1, Math.floor(innerW / n));
  const barW = Math.max(1, Math.min(slot, 72, Math.round(slot * 0.66)));
  const groupW = (n - 1) * slot + barW;
  const offset = Math.max(0, Math.floor((innerW - groupW) / 2));
  return { slot, barW, offset };
}

export function chartLabelIndices(count: number, maxLabels = 5): number[] {
  if (count <= 0) return [];
  if (count <= 8) return Array.from({ length: count }, (_, i) => i);
  const step = Math.ceil((count - 1) / (Math.max(2, maxLabels) - 1));
  const out: number[] = [];
  for (let i = 0; i < count; i += step) out.push(i);
  const last = out[out.length - 1]!;
  if (last !== count - 1) {
    if (count - 1 - last < step / 2) out.pop();
    out.push(count - 1);
  }
  return out;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function shareAxisLabel(period: string, bucket: ActivityBucket): string {
  if (bucket === "week") return formatPeriodLabel(period, bucket);
  const m = period.match(/^\d{4}-(\d{2})-(\d{2})$/);
  const month = m ? MONTHS[Number(m[1]) - 1] : undefined;
  return m && month ? `${month} ${Number(m[2])}` : period;
}

const compactCount = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatShareCount(value: number): string {
  const v = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return v < 10_000 ? v.toLocaleString("en-US") : compactCount.format(v);
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

export function roundedRect(
  ctx: DrawCtx,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[],
): void {
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.rect(x, y, w, h);
}

export function fitFont(
  ctx: DrawCtx,
  text: string,
  maxW: number,
  weight: string,
  size: number,
  family: string,
  minSize: number,
): void {
  let px = size;
  ctx.font = `${weight} ${px}px ${family}`;
  while (px > minSize && ctx.measureText(text).width > maxW) {
    px -= 2;
    ctx.font = `${weight} ${px}px ${family}`;
  }
}

type StatCell = { value: string; label: string };

function statCells(payload: FlightSharePayload): StatCell[] {
  const streak: StatCell =
    payload.streak > 0
      ? {
          value: String(payload.streak),
          label:
            payload.longestStreak > payload.streak
              ? `DAY STREAK · BEST ${payload.longestStreak}`
              : "DAY STREAK",
        }
      : { value: formatShareCount(payload.lifetimeXp), label: "LIFETIME XP" };
  return [
    { value: formatShareCount(payload.marked), label: "POSTS" },
    { value: formatShareCount(payload.views), label: "VIEWS" },
    { value: String(payload.level), label: "LEVEL" },
    streak,
  ];
}

function kickerText(payload: FlightSharePayload): string {
  if (payload.bucket === "week") return "THIS WEEK";
  const first = payload.series[0];
  const last = payload.series[payload.series.length - 1];
  if (!first || !last) return "LAST 28 DAYS";
  const range = `${shareAxisLabel(first.period, "day")} – ${shareAxisLabel(last.period, "day")}`;
  return `LAST 28 DAYS · ${range.toUpperCase()}`;
}

export function drawFlightShareImage(
  ctx: DrawCtx,
  payload: FlightSharePayload,
  width = FLIGHT_SHARE_WIDTH,
  height = FLIGHT_SHARE_HEIGHT,
): void {
  const L = flightShareLayout(width, height, Boolean(payload.nextGoal));
  const { padX, contentW, inset } = L;
  const right = padX + contentW;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  roundedRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 20);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const wash = ctx.createLinearGradient(0, inset, 0, L.chart.y);
  wash.addColorStop(0, "rgba(126, 184, 220, 0.12)");
  wash.addColorStop(1, "rgba(126, 184, 220, 0)");
  ctx.fillStyle = wash;
  ctx.beginPath();
  roundedRect(ctx, inset + 1, inset + 1, width - inset * 2 - 2, L.chart.y - inset, [19, 19, 0, 0]);
  ctx.fill();

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = `600 44px ${FONT_HEAD}`;
  ctx.fillText(PRODUCT_NAME, padX, L.titleY);

  ctx.font = `600 18px ${FONT_HEAD}`;
  const pill = "FLIGHT PATH";
  const pillW = ctx.measureText(pill).width + 36;
  ctx.fillStyle = C.accentWash;
  ctx.beginPath();
  roundedRect(ctx, right - pillW, L.titleY + 4, pillW, 38, 19);
  ctx.fill();
  ctx.fillStyle = C.accent;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(pill, right - pillW / 2, L.titleY + 24);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";

  ctx.fillStyle = C.muted;
  ctx.font = `600 18px ${FONT_HEAD}`;
  ctx.fillText(kickerText(payload), padX, L.kickerY);
  ctx.fillStyle = C.accent;
  ctx.fillRect(padX, L.ruleY, 72, 4);

  statCells(payload).forEach((cell, i) => {
    const cx = padX + i * L.statColW;
    const maxW = L.statColW - 44;
    ctx.fillStyle = C.text;
    fitFont(ctx, cell.value, maxW, "600", 68, FONT_HEAD, 36);
    ctx.fillText(cell.value, cx, L.statValueY);
    ctx.fillStyle = C.muted;
    fitFont(ctx, cell.label, maxW, "500", 17, FONT_BODY, 12);
    ctx.fillText(cell.label, cx, L.statLabelY);
  });

  drawPathChart(ctx, payload, L.chart);

  if (payload.nextGoal && L.goalY !== null) {
    ctx.fillStyle = C.accent;
    ctx.font = `600 16px ${FONT_HEAD}`;
    ctx.fillText("NEXT", padX, L.goalY);
    ctx.fillStyle = C.text;
    ctx.font = `400 26px ${FONT_BODY}`;
    ctx.fillText(clip(payload.nextGoal, 56), padX, L.goalY + 30);
  }

  ctx.fillStyle = C.border;
  ctx.fillRect(padX, L.footerTop, contentW, 2);
  ctx.textBaseline = "middle";
  ctx.fillStyle = C.accent;
  ctx.font = `600 26px ${FONT_HEAD}`;
  ctx.fillText(FLIGHT_SHARE_SITE, padX, L.footerTextY);
  const siteW = ctx.measureText(FLIGHT_SHARE_SITE).width;
  ctx.fillStyle = C.muted;
  fitFont(ctx, FLIGHT_SHARE_DISCLAIMER, contentW - siteW - 40, "400", 18, FONT_BODY, 12);
  ctx.textAlign = "right";
  ctx.fillText(FLIGHT_SHARE_DISCLAIMER, right, L.footerTextY);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

const CHART_PAD_X = 32;
const CHART_PAD_TOP = 104;
const CHART_PAD_BOTTOM = 64;

function drawLegend(
  ctx: DrawCtx,
  x: number,
  y: number,
  withViews: boolean,
): void {
  const items: [string, string][] = [
    ["Originals", C.original],
    ["Quotes", C.quote],
    ["Replies", C.reply],
  ];
  ctx.font = `400 18px ${FONT_BODY}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  let cx = x;
  for (const [label, color] of items) {
    ctx.fillStyle = color;
    ctx.beginPath();
    roundedRect(ctx, cx, y - 7, 14, 14, 3);
    ctx.fill();
    ctx.fillStyle = C.muted;
    ctx.fillText(label, cx + 22, y);
    cx += 22 + ctx.measureText(label).width + 30;
  }
  if (withViews) {
    ctx.fillStyle = C.viewsLine;
    ctx.fillRect(cx, y - 1.5, 22, 3);
    ctx.fillStyle = C.muted;
    ctx.fillText("Views", cx + 30, y);
  }
  ctx.textBaseline = "top";
}

function drawPathChart(
  ctx: DrawCtx,
  payload: FlightSharePayload,
  r: FlightShareRect,
): void {
  ctx.fillStyle = C.raised;
  ctx.beginPath();
  roundedRect(ctx, r.x, r.y, r.w, r.h, 14);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const series = payload.series;
  const hasViews = payload.altitude.some((p) => p.views > 0);
  const innerX = r.x + CHART_PAD_X;
  const innerW = r.w - CHART_PAD_X * 2;
  drawLegend(ctx, innerX, r.y + 38, hasViews);

  const plotTop = r.y + CHART_PAD_TOP;
  const baseY = Math.round(r.y + r.h - CHART_PAD_BOTTOM);
  const innerH = baseY - plotTop;
  const n = series.length;

  let maxIx = 1;
  for (const p of series) {
    const total = Math.max(p.interactions, postKindTotal(postKindCounts(p)));
    if (total > maxIx) maxIx = total;
  }
  let maxAlt = 1;
  for (const p of payload.altitude) {
    if (p.views > maxAlt) maxAlt = p.views;
  }

  ctx.fillStyle = C.grid;
  ctx.fillRect(innerX, plotTop, innerW, 1);
  ctx.fillRect(innerX, Math.round(plotTop + innerH / 2), innerW, 1);
  ctx.fillStyle = C.faint;
  ctx.font = `400 16px ${FONT_BODY}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  const perLabel = payload.bucket === "week" ? "/ week" : "/ day";
  ctx.fillText(`${formatShareCount(maxIx)} posts ${perLabel}`, innerX + innerW, plotTop - 8);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  const bars = chartBarLayout(innerW, n);
  const barX = (i: number) => innerX + bars.offset + i * bars.slot;
  const center = (i: number) => barX(i) + bars.barW / 2;

  if (hasViews && n > 1) {
    const peak = innerH * 0.9;
    const pts = payload.altitude.map((p, i) => ({
      x: center(i),
      y: baseY - (p.views / maxAlt) * peak,
    }));
    ctx.fillStyle = C.viewsFill;
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, baseY);
    for (const pt of pts) ctx.lineTo(pt.x, pt.y);
    ctx.lineTo(pts[pts.length - 1]!.x, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = C.viewsLine;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.x, pt.y);
      else ctx.lineTo(pt.x, pt.y);
    });
    ctx.stroke();
  }

  const segmentFill: Record<"original" | "quote" | "reply", string> = {
    original: C.original,
    quote: C.quote,
    reply: C.reply,
  };
  series.forEach((p, i) => {
    const bx = barX(i);
    const segments = stackBarSegments(postKindCounts(p), maxIx, innerH);
    if (segments.length === 0) {
      ctx.fillStyle = C.borderStrong;
      ctx.fillRect(bx, baseY - 4, bars.barW, 4);
      return;
    }
    let cum = 0;
    let prevTop = baseY;
    segments.forEach((seg, si) => {
      cum += seg.height;
      const isTop = si === segments.length - 1;
      const top = Math.min(prevTop - (isTop ? 4 : 0), Math.round(baseY - cum));
      const h = prevTop - top;
      if (h <= 0) return;
      ctx.fillStyle = segmentFill[seg.key];
      if (isTop) {
        const radius = Math.min(6, bars.barW / 2, h);
        ctx.beginPath();
        roundedRect(ctx, bx, top, bars.barW, h, [radius, radius, 0, 0]);
        ctx.fill();
      } else {
        ctx.fillRect(bx, top, bars.barW, h);
      }
      prevTop = top;
    });
  });

  ctx.fillStyle = C.borderStrong;
  ctx.fillRect(innerX, baseY, innerW, 2);

  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${FONT_BODY}`;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  for (const i of chartLabelIndices(n)) {
    const point = series[i];
    if (!point) continue;
    const label = shareAxisLabel(point.period, payload.bucket);
    const w = ctx.measureText(label).width;
    const lx = Math.min(
      Math.max(center(i) - w / 2, innerX),
      innerX + innerW - w,
    );
    ctx.fillText(label, lx, baseY + 20);
  }
}

const FLIGHT_SHARE_FONTS = [
  `600 68px ${FONT_HEAD}`,
  `400 20px ${FONT_BODY}`,
  `500 17px ${FONT_BODY}`,
];

async function loadFlightShareFonts(): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return;
  const loaded = Promise.all(FLIGHT_SHARE_FONTS.map((f) => fonts.load(f)));
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
  await Promise.race([loaded, timeout]).catch(() => undefined);
}

export async function renderFlightShareBlob(
  payload: FlightSharePayload,
): Promise<Blob> {
  await loadFlightShareFonts();
  const canvas = document.createElement("canvas");
  canvas.width = FLIGHT_SHARE_WIDTH;
  canvas.height = FLIGHT_SHARE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the flight path.");
  drawFlightShareImage(ctx, payload);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))),
      "image/png",
    );
  });
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyFlightShareCaption(
  payload: FlightSharePayload,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(flightShareCaption(payload));
    return true;
  } catch {
    return false;
  }
}

export async function downloadFlightSharePng(
  payload: FlightSharePayload,
): Promise<void> {
  const blob = await renderFlightShareBlob(payload);
  triggerDownload(blob, flightShareFilename(payload));
}
