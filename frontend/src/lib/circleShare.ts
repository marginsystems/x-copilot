import { apiFetch } from "./apiBase";
import {
  FLIGHT_SHARE_DISCLAIMER,
  FLIGHT_SHARE_HEIGHT,
  FLIGHT_SHARE_SITE,
  FLIGHT_SHARE_WIDTH,
  SHARE_FONT_BODY,
  SHARE_FONT_HEAD,
  SHARE_PALETTE,
  fitFont,
  formatShareCount,
  roundedRect,
  triggerDownload,
  type DrawCtx,
} from "./flightShare";
import { PRODUCT_NAME } from "./legal";
import { isRecord } from "./typeGuards";

export type CircleMember = {
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  replies: number;
  quotes: number;
  score: number;
  lastAt: string;
};

export type CircleResponse = {
  handle: string | null;
  name: string | null;
  avatarUrl: string | null;
  generatedAt: string;
  members: CircleMember[];
  totals: { replies: number; quotes: number; people: number };
};

export type CircleSharePayload = CircleResponse;

export const CIRCLE_SHARE_WIDTH = FLIGHT_SHARE_WIDTH;
export const CIRCLE_SHARE_HEIGHT = FLIGHT_SHARE_HEIGHT;
export const CIRCLE_SHARE_FILENAME = "xcopilot-circle.png";
export const CIRCLE_MAX_MEMBERS = 64;
export const CIRCLE_MIN_MEMBERS = 3;
export const CIRCLE_RING_CAPACITY = [8, 20, 36] as const;
export const CIRCLE_SELF_RADIUS = 92;
export const CIRCLE_IMAGE_TIMEOUT_MS = 4000;

const C = SHARE_PALETTE;
const FONT_HEAD = SHARE_FONT_HEAD;
const FONT_BODY = SHARE_FONT_BODY;

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t : null;
}

function cleanHandle(value: unknown): string | null {
  const t = optionalText(value);
  if (!t) return null;
  const h = t.replace(/^@+/, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(h) ? h : null;
}

function httpUrl(value: unknown): string | null {
  const t = optionalText(value);
  return t && /^https?:\/\//i.test(t) ? t : null;
}

function parseMember(raw: unknown): CircleMember | null {
  if (!isRecord(raw)) return null;
  const m = raw;
  const handle = cleanHandle(m.handle);
  if (!handle) return null;
  if (typeof m.replies !== "number" || typeof m.quotes !== "number") return null;
  return {
    handle,
    name: optionalText(m.name),
    avatarUrl: httpUrl(m.avatarUrl),
    replies: count(m.replies),
    quotes: count(m.quotes),
    score: count(m.score),
    lastAt: typeof m.lastAt === "string" ? m.lastAt : "",
  };
}

export function parseCircleResponse(json: unknown): CircleResponse | null {
  if (!isRecord(json)) return null;
  const data = json;
  if (!Array.isArray(data.members)) return null;
  const members = data.members
    .map(parseMember)
    .filter((m): m is CircleMember => m !== null)
    .slice(0, CIRCLE_MAX_MEMBERS);
  const totals: Record<string, unknown> = isRecord(data.totals) ? data.totals : {};
  return {
    handle: cleanHandle(data.handle),
    name: optionalText(data.name),
    avatarUrl: httpUrl(data.avatarUrl),
    generatedAt: typeof data.generatedAt === "string" ? data.generatedAt : "",
    members,
    totals: {
      replies:
        typeof totals.replies === "number"
          ? count(totals.replies)
          : members.reduce((s, m) => s + m.replies, 0),
      quotes:
        typeof totals.quotes === "number"
          ? count(totals.quotes)
          : members.reduce((s, m) => s + m.quotes, 0),
      people:
        typeof totals.people === "number" ? count(totals.people) : members.length,
    },
  };
}

export async function fetchCircle(): Promise<CircleResponse | null> {
  const res = await apiFetch("/api/circle");
  if (!res.ok) throw new Error("Circle request failed");
  const parsed = parseCircleResponse(await res.json());
  if (!parsed) throw new Error("Invalid circle response");
  return parsed;
}

export function circleRefreshKey(
  history: readonly { threadId: string; at: string }[],
): string {
  let newest = "";
  for (const entry of history) if (entry.at > newest) newest = entry.at;
  return `${history.length}:${newest}`;
}

export function circleSharePayload(
  resp: CircleResponse | null,
): CircleSharePayload | null {
  if (!resp || resp.members.length < CIRCLE_MIN_MEMBERS) return null;
  return { ...resp, members: resp.members.slice(0, CIRCLE_MAX_MEMBERS) };
}

export function circleShareCaption(payload: CircleSharePayload): string {
  const head = `My X Circle — the ${payload.members.length} people I talk with most on X.`;
  return [head, "", FLIGHT_SHARE_SITE, FLIGHT_SHARE_DISCLAIMER].join("\n");
}

export function circleShareIntentUrl(payload: CircleSharePayload): string {
  const params = new URLSearchParams({ text: circleShareCaption(payload) });
  return `https://x.com/intent/tweet?${params.toString()}`;
}

export type CirclePosition = {
  index: number;
  ring: number;
  x: number;
  y: number;
  r: number;
};

const RING_AVATAR_RADII = [46, 34, 26] as const;
const RING_ORBITS = [0.42, 0.7, 0.925] as const;
const RING_OFFSETS = [0, 0.5, 0.25] as const;
const LAYOUT_REFERENCE_RADIUS = 390;

export function circleRings(
  count: number,
  cx: number,
  cy: number,
  radiusMax: number,
): CirclePosition[] {
  const total = Math.max(0, Math.min(Math.floor(count), CIRCLE_MAX_MEMBERS));
  const scale = radiusMax / LAYOUT_REFERENCE_RADIUS;
  const out: CirclePosition[] = [];
  let start = 0;
  CIRCLE_RING_CAPACITY.forEach((capacity, ring) => {
    const n = Math.min(capacity, total - start);
    if (n <= 0) return;
    const step = (Math.PI * 2) / n;
    const orbit = radiusMax * RING_ORBITS[ring]!;
    const offset = -Math.PI / 2 + step * RING_OFFSETS[ring]!;
    for (let i = 0; i < n; i++) {
      const angle = offset + i * step;
      out.push({
        index: start + i,
        ring,
        x: cx + Math.cos(angle) * orbit,
        y: cy + Math.sin(angle) * orbit,
        r: RING_AVATAR_RADII[ring]! * scale,
      });
    }
    start += n;
  });
  return out;
}

export type CircleShareLayout = {
  inset: number;
  padX: number;
  contentW: number;
  titleY: number;
  kickerY: number;
  ruleY: number;
  cx: number;
  cy: number;
  radiusMax: number;
  selfR: number;
  handleY: number;
  dateY: number;
  countsY: number;
  footerTop: number;
  footerTextY: number;
};

const CARD_INSET = 36;
const CARD_PAD = 48;
const FOOTER_H = 60;

export function circleShareLayout(width: number, height: number): CircleShareLayout {
  const padX = CARD_INSET + CARD_PAD;
  const contentW = width - padX * 2;
  const top = CARD_INSET + CARD_PAD;
  const bottom = height - CARD_INSET - CARD_PAD;
  const kickerY = top + 66;
  const ruleY = kickerY + 34;
  const footerTop = bottom - FOOTER_H;
  const countsY = footerTop - 58;
  const dateY = countsY - 40;
  const handleY = dateY - 66;
  const areaTop = ruleY + 20;
  const areaBottom = handleY - 24;
  const radiusMax = Math.min(contentW / 2, (areaBottom - areaTop) / 2);
  return {
    inset: CARD_INSET,
    padX,
    contentW,
    titleY: top,
    kickerY,
    ruleY,
    cx: width / 2,
    cy: (areaTop + areaBottom) / 2,
    radiusMax,
    selfR: CIRCLE_SELF_RADIUS * (radiusMax / LAYOUT_REFERENCE_RADIUS),
    handleY,
    dateY,
    countsY,
    footerTop,
    footerTextY: footerTop + 34,
  };
}

export type CircleDrawCtx = DrawCtx & {
  arc: (x: number, y: number, radius: number, startAngle: number, endAngle: number) => void;
  save: () => void;
  restore: () => void;
  clip: () => void;
  drawImage: (image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number) => void;
  createRadialGradient: (
    x0: number,
    y0: number,
    r0: number,
    x1: number,
    y1: number,
    r1: number,
  ) => { addColorStop: (offset: number, color: string) => void };
  shadowBlur: number;
  shadowColor: string;
};

export function circleInitials(name: string | null, handle: string | null): string {
  const words = (name ?? "")
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
  if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
  const h = (handle ?? "").replace(/[^A-Za-z0-9]/g, "");
  return h ? h.slice(0, 2).toUpperCase() : "?";
}

const INITIAL_TONES = [
  { fill: "rgba(108, 159, 192, 0.28)", text: "#9cc4dd" },
  { fill: "rgba(126, 168, 143, 0.28)", text: "#a5c9b3" },
  { fill: "rgba(212, 165, 116, 0.26)", text: "#e2bf98" },
  { fill: "rgba(168, 159, 148, 0.22)", text: "#cfc6bb" },
] as const;

function toneFor(key: string): (typeof INITIAL_TONES)[number] {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return INITIAL_TONES[h % INITIAL_TONES.length]!;
}

export function formatCircleDate(iso: string): string | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(t));
}

function plural(n: number, one: string, many: string): string {
  return `${formatShareCount(n)} ${Math.round(n) === 1 ? one : many}`;
}

export function circleCountsLine(payload: CircleSharePayload): string {
  const { replies, quotes } = payload.totals;
  return [
    plural(replies, "reply", "replies"),
    plural(quotes, "quote", "quotes"),
    plural(payload.members.length, "person", "people"),
  ].join(" · ");
}

function circlePath(ctx: CircleDrawCtx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.closePath();
}

function drawAvatar(
  ctx: CircleDrawCtx,
  x: number,
  y: number,
  r: number,
  image: CanvasImageSource | null | undefined,
  name: string | null,
  handle: string | null,
): void {
  if (image) {
    ctx.fillStyle = C.raised;
    circlePath(ctx, x, y, r);
    ctx.fill();
    ctx.save();
    circlePath(ctx, x, y, r);
    ctx.clip();
    ctx.drawImage(image, x - r, y - r, r * 2, r * 2);
    ctx.restore();
    return;
  }
  const tone = toneFor(handle ?? name ?? "");
  ctx.fillStyle = C.raised;
  circlePath(ctx, x, y, r);
  ctx.fill();
  ctx.fillStyle = tone.fill;
  circlePath(ctx, x, y, r);
  ctx.fill();
  const initials = circleInitials(name, handle);
  ctx.fillStyle = tone.text;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  fitFont(ctx, initials, r * 1.4, "600", Math.round(r * 0.78), FONT_HEAD, 10);
  ctx.fillText(initials, x, y + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

function ring(ctx: CircleDrawCtx, x: number, y: number, r: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  circlePath(ctx, x, y, r);
  ctx.stroke();
}

function kickerText(payload: CircleSharePayload): string {
  return `THE ${payload.members.length} PEOPLE I TALK WITH MOST`;
}

function drawFrame(ctx: CircleDrawCtx, L: CircleShareLayout, width: number, height: number): void {
  const { inset } = L;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = C.panel;
  ctx.beginPath();
  roundedRect(ctx, inset, inset, width - inset * 2, height - inset * 2, 20);
  ctx.fill();
  ctx.strokeStyle = C.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const wash = ctx.createLinearGradient(0, inset, 0, L.ruleY + 40);
  wash.addColorStop(0, "rgba(126, 184, 220, 0.12)");
  wash.addColorStop(1, "rgba(126, 184, 220, 0)");
  ctx.fillStyle = wash;
  ctx.beginPath();
  roundedRect(ctx, inset + 1, inset + 1, width - inset * 2 - 2, L.ruleY + 40 - inset, [19, 19, 0, 0]);
  ctx.fill();
}

function drawHeader(ctx: CircleDrawCtx, L: CircleShareLayout, payload: CircleSharePayload): void {
  const right = L.padX + L.contentW;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillStyle = C.text;
  ctx.font = `600 44px ${FONT_HEAD}`;
  ctx.fillText(PRODUCT_NAME, L.padX, L.titleY);

  ctx.font = `600 18px ${FONT_HEAD}`;
  const pill = "X CIRCLE";
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
  ctx.fillText(kickerText(payload), L.padX, L.kickerY);
  ctx.fillStyle = C.accent;
  ctx.fillRect(L.padX, L.ruleY, 72, 4);
}

function drawOrbit(
  ctx: CircleDrawCtx,
  L: CircleShareLayout,
  payload: CircleSharePayload,
  images: Map<string, CanvasImageSource | null>,
): void {
  const { cx, cy, radiusMax, selfR } = L;
  const glow = ctx.createRadialGradient(cx, cy, selfR * 0.6, cx, cy, radiusMax);
  glow.addColorStop(0, "rgba(126, 184, 220, 0.16)");
  glow.addColorStop(0.45, "rgba(126, 184, 220, 0.05)");
  glow.addColorStop(1, "rgba(126, 184, 220, 0)");
  ctx.fillStyle = glow;
  circlePath(ctx, cx, cy, radiusMax);
  ctx.fill();

  const positions = circleRings(payload.members.length, cx, cy, radiusMax);
  const orbits = new Map<number, number>();
  for (const p of positions) {
    if (!orbits.has(p.ring)) orbits.set(p.ring, Math.hypot(p.x - cx, p.y - cy));
  }
  for (const radius of orbits.values()) ring(ctx, cx, cy, radius, C.grid, 2);

  for (const p of [...positions].reverse()) {
    const m = payload.members[p.index];
    if (!m) continue;
    const img = m.avatarUrl ? images.get(m.avatarUrl) : null;
    drawAvatar(ctx, p.x, p.y, p.r, img, m.name, m.handle);
    if (p.ring === 0) ring(ctx, p.x, p.y, p.r + 3, "rgba(126, 184, 220, 0.6)", 3);
    else ring(ctx, p.x, p.y, p.r + 1, C.border, 2);
  }

  ctx.save();
  ctx.shadowColor = "rgba(126, 184, 220, 0.85)";
  ctx.shadowBlur = 40;
  ring(ctx, cx, cy, selfR + 10, C.accent, 5);
  ctx.restore();
  ring(ctx, cx, cy, selfR + 22, "rgba(126, 184, 220, 0.22)", 2);
  const selfImg = payload.avatarUrl ? images.get(payload.avatarUrl) : null;
  drawAvatar(ctx, cx, cy, selfR, selfImg, payload.name, payload.handle);
}

function drawFooter(ctx: CircleDrawCtx, L: CircleShareLayout, payload: CircleSharePayload): void {
  const { padX, contentW } = L;
  const right = padX + contentW;
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  const who = payload.handle ? `@${payload.handle}` : payload.name ?? "My X Circle";
  ctx.fillStyle = C.text;
  fitFont(ctx, who, contentW, "600", 56, FONT_HEAD, 30);
  ctx.fillText(who, padX, L.handleY);

  const date = formatCircleDate(payload.generatedAt);
  const dateLine = date ? `X Circle · ${date}` : "X Circle";
  ctx.fillStyle = C.accent;
  ctx.font = `600 24px ${FONT_HEAD}`;
  ctx.fillText(dateLine, padX, L.dateY);

  ctx.fillStyle = C.muted;
  fitFont(ctx, circleCountsLine(payload), contentW, "400", 22, FONT_BODY, 14);
  ctx.fillText(circleCountsLine(payload), padX, L.countsY);

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

export function drawCircleShareImage(
  ctx: CircleDrawCtx,
  payload: CircleSharePayload,
  images: Map<string, CanvasImageSource | null>,
  width = CIRCLE_SHARE_WIDTH,
  height = CIRCLE_SHARE_HEIGHT,
): void {
  const L = circleShareLayout(width, height);
  drawFrame(ctx, L, width, height);
  drawHeader(ctx, L, payload);
  drawOrbit(ctx, L, payload, images);
  drawFooter(ctx, L, payload);
}

export function sharpAvatarUrl(url: string, size: "200x200" | "400x400"): string {
  return url.replace(/_(normal|bigger|mini)(\.[a-z]+)?(\?.*)?$/i, `_${size}$2$3`);
}

function loadImage(url: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (value: HTMLImageElement | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => finish(img.naturalWidth > 0 ? img : null);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

async function loadAvatar(url: string, size: "200x200" | "400x400"): Promise<HTMLImageElement | null> {
  const sharp = sharpAvatarUrl(url, size);
  const img = await loadImage(sharp, CIRCLE_IMAGE_TIMEOUT_MS);
  if (img || sharp === url) return img;
  return loadImage(url, CIRCLE_IMAGE_TIMEOUT_MS);
}

export async function loadCircleImages(
  payload: CircleSharePayload,
): Promise<Map<string, CanvasImageSource | null>> {
  const wanted = new Map<string, "200x200" | "400x400">();
  if (payload.avatarUrl) wanted.set(payload.avatarUrl, "400x400");
  for (const m of payload.members) {
    if (m.avatarUrl && !wanted.has(m.avatarUrl)) wanted.set(m.avatarUrl, "200x200");
  }
  const entries = await Promise.all(
    [...wanted].map(async ([url, size]) => [url, await loadAvatar(url, size)] as const),
  );
  return new Map<string, CanvasImageSource | null>(entries);
}

const CIRCLE_SHARE_FONTS = [
  `600 56px ${FONT_HEAD}`,
  `600 24px ${FONT_HEAD}`,
  `400 22px ${FONT_BODY}`,
];

async function loadCircleShareFonts(): Promise<void> {
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fonts) return;
  const loaded = Promise.all(CIRCLE_SHARE_FONTS.map((f) => fonts.load(f)));
  const timeout = new Promise((resolve) => setTimeout(resolve, 1500));
  await Promise.race([loaded, timeout]).catch(() => undefined);
}

export async function renderCircleShareBlob(
  payload: CircleSharePayload,
  images?: Map<string, CanvasImageSource | null>,
): Promise<Blob> {
  const [loaded] = await Promise.all([
    images ?? loadCircleImages(payload),
    loadCircleShareFonts(),
  ]);
  const canvas = document.createElement("canvas");
  canvas.width = CIRCLE_SHARE_WIDTH;
  canvas.height = CIRCLE_SHARE_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the X Circle.");
  drawCircleShareImage(ctx, payload, loaded);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode PNG."))),
      "image/png",
    );
  });
}

export async function downloadCircleSharePng(
  payload: CircleSharePayload,
  images?: Map<string, CanvasImageSource | null>,
): Promise<void> {
  const blob = await renderCircleShareBlob(payload, images);
  triggerDownload(blob, CIRCLE_SHARE_FILENAME);
}
