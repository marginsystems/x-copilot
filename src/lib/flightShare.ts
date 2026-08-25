/**
 * User-triggered flight-path PNG. They download (or share) their own
 * marks, altitude, streak, and level. Not a public URL. Never a watermark
 * on replies they send.
 */
import { LEGAL_ENTITY, PRODUCT_NAME } from "./legal";
import {
  formatPeriodLabel,
  viewsLineAltitude,
  type ActivityBucket,
  type ActivitySeriesPoint,
  type ActivityStats,
} from "./activityStats";
import type { GamificationStats } from "./gamification";

export const FLIGHT_SHARE_WIDTH = 1080;
export const FLIGHT_SHARE_HEIGHT = 1350;
export const FLIGHT_SHARE_SITE = "xcopilot.dev";
export const FLIGHT_SHARE_DISCLAIMER = `Built by ${LEGAL_ENTITY}. Not affiliated with X Corp.`;

const C = {
  bg: "#161310",
  panel: "#1f1b17",
  raised: "#26211c",
  border: "#3a332c",
  borderStrong: "#4d453c",
  text: "#f4eee6",
  muted: "#a89f94",
  accent: "#7eb8dc",
};

const FONT_HEAD = '"Space Grotesk", "Segoe UI", sans-serif';
const FONT_BODY = '"IBM Plex Mono", ui-monospace, "SF Mono", Menlo, monospace';

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
  const head = `${window} — ${payload.marked} marked, Lv ${payload.level}${streak}.`;
  return [head, "", FLIGHT_SHARE_SITE, FLIGHT_SHARE_DISCLAIMER].join("\n");
}

type DrawCtx = {
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
  moveTo: CanvasRenderingContext2D["moveTo"];
  lineTo: CanvasRenderingContext2D["lineTo"];
};

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1))}…`;
}

export function drawFlightShareImage(
  ctx: DrawCtx,
  payload: FlightSharePayload,
  width = FLIGHT_SHARE_WIDTH,
  height = FLIGHT_SHARE_HEIGHT,
): void {
  const padX = 80;
  const contentW = width - padX * 2;
  const footerTop = height - 148;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  ctx.roundRect(36, 36, width - 72, height - 72, 18);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const wash = ctx.createLinearGradient(0, 36, 0, 360);
  wash.addColorStop(0, "rgba(126, 184, 220, 0.14)");
  wash.addColorStop(1, "rgba(22, 19, 16, 0)");
  ctx.fillStyle = wash;
  ctx.fillRect(36, 36, width - 72, 324);

  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = `600 40px ${FONT_HEAD}`;
  ctx.fillText(PRODUCT_NAME, padX, 72);
  ctx.fillStyle = C.accent;
  ctx.font = `600 20px ${FONT_HEAD}`;
  ctx.textAlign = "right";
  ctx.fillText("FLIGHT PATH", width - padX, 86);
  ctx.textAlign = "left";

  ctx.fillStyle = C.muted;
  ctx.font = `600 18px ${FONT_HEAD}`;
  const kicker =
    payload.bucket === "week" ? "THIS WEEK" : "LAST 28 DAYS";
  ctx.fillText(kicker, padX, 140);
  ctx.fillStyle = C.accent;
  ctx.fillRect(padX, 176, 72, 4);

  ctx.fillStyle = C.text;
  ctx.font = `600 56px ${FONT_HEAD}`;
  ctx.fillText(String(payload.marked), padX, 214);
  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${FONT_BODY}`;
  ctx.fillText("marked", padX, 280);

  const col2 = padX + 220;
  ctx.fillStyle = C.text;
  ctx.font = `600 56px ${FONT_HEAD}`;
  ctx.fillText(String(payload.views), col2, 214);
  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${FONT_BODY}`;
  ctx.fillText("views", col2, 280);

  const col3 = padX + 480;
  ctx.fillStyle = C.text;
  ctx.font = `600 56px ${FONT_HEAD}`;
  ctx.fillText(`Lv ${payload.level}`, col3, 214);
  ctx.fillStyle = C.muted;
  ctx.font = `400 20px ${FONT_BODY}`;
  const streakLine =
    payload.streak > 0
      ? `streak ${payload.streak}${
          payload.longestStreak > payload.streak
            ? ` · best ${payload.longestStreak}`
            : ""
        }`
      : `${payload.lifetimeXp} XP`;
  ctx.fillText(streakLine, col3, 280);

  drawPathChart(ctx, payload, padX, 360, contentW, 520);

  if (payload.nextGoal) {
    ctx.fillStyle = C.accent;
    ctx.font = `600 16px ${FONT_HEAD}`;
    ctx.fillText("NEXT", padX, 920);
    ctx.fillStyle = C.text;
    ctx.font = `400 22px ${FONT_BODY}`;
    ctx.fillText(clip(payload.nextGoal, 64), padX, 952);
  }

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(padX, footerTop);
  ctx.lineTo(width - padX, footerTop);
  ctx.stroke();
  ctx.fillStyle = C.accent;
  ctx.font = `600 24px ${FONT_HEAD}`;
  ctx.fillText(FLIGHT_SHARE_SITE, padX, footerTop + 24);
  ctx.fillStyle = C.muted;
  ctx.font = `400 16px ${FONT_BODY}`;
  ctx.fillText(FLIGHT_SHARE_DISCLAIMER, padX, footerTop + 62);
}

function drawPathChart(
  ctx: DrawCtx,
  payload: FlightSharePayload,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.fillStyle = C.raised;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const series = payload.series;
  if (series.length === 0) return;

  const padL = 28;
  const padR = 20;
  const padT = 28;
  const padB = 48;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const n = series.length;
  const gap = 3;
  const barW = Math.max(3, (innerW - gap * (n - 1)) / n);

  let maxIx = 1;
  let maxAlt = 1;
  for (const p of series) {
    if (p.interactions > maxIx) maxIx = p.interactions;
  }
  for (const p of payload.altitude) {
    if (p.views > maxAlt) maxAlt = p.views;
  }

  ctx.strokeStyle = C.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + padL, y + padT + innerH);
  ctx.lineTo(x + padL + innerW, y + padT + innerH);
  ctx.stroke();

  series.forEach((p, i) => {
    const bx = x + padL + i * (barW + gap);
    const bh = (p.interactions / maxIx) * innerH;
    ctx.fillStyle = "rgba(126, 184, 220, 0.28)";
    ctx.fillRect(bx, y + padT + innerH - bh, barW, Math.max(bh, p.interactions > 0 ? 2 : 0));
  });

  const pts = payload.altitude.map((p, i) => {
    const cx = x + padL + i * (barW + gap) + barW / 2;
    const cy = y + padT + innerH - (p.views / maxAlt) * innerH;
    return { cx, cy, p };
  });
  if (pts.length > 1) {
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    pts.forEach((pt, i) => {
      if (i === 0) ctx.moveTo(pt.cx, pt.cy);
      else ctx.lineTo(pt.cx, pt.cy);
    });
    ctx.stroke();
  }

  ctx.fillStyle = C.accent;
  for (const pt of pts) {
    if (pt.p.interactions < 1 && pt.p.views < 1) continue;
    ctx.beginPath();
    ctx.roundRect(pt.cx - 3, pt.cy - 3, 6, 6, 3);
    ctx.fill();
  }

  ctx.fillStyle = C.muted;
  ctx.font = `400 16px ${FONT_BODY}`;
  ctx.textAlign = "center";
  const labelStep =
    payload.bucket === "week" ? 1 : Math.max(1, Math.ceil(n / 7));
  series.forEach((p, i) => {
    if (i % labelStep !== 0 && i !== n - 1) return;
    ctx.fillText(
      formatPeriodLabel(p.period, payload.bucket),
      x + padL + i * (barW + gap) + barW / 2,
      y + h - 28,
    );
  });
  ctx.textAlign = "left";
}

export function renderFlightShareBlob(payload: FlightSharePayload): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = FLIGHT_SHARE_WIDTH;
  canvas.height = FLIGHT_SHARE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("Could not draw the flight path."));
  drawFlightShareImage(ctx, payload);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))),
      "image/png",
    );
  });
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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

export type FlightShareResult = {
  method: "share" | "download";
  copiedCaption: boolean;
};

export async function shareFlightPath(
  payload: FlightSharePayload,
): Promise<FlightShareResult> {
  const blob = await renderFlightShareBlob(payload);
  const filename = flightShareFilename(payload);
  const file = new File([blob], filename, { type: "image/png" });
  const caption = flightShareCaption(payload);

  if (typeof navigator.share === "function") {
    try {
      const can = navigator.canShare?.({ files: [file] }) ?? false;
      if (can) {
        await navigator.share({
          files: [file],
          text: caption,
          title: "Flight path",
        });
        return { method: "share", copiedCaption: false };
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") throw err;
    }
  }

  triggerDownload(blob, filename);
  return {
    method: "download",
    copiedCaption: await copyFlightShareCaption(payload),
  };
}
