import { SCOUT_SPRITE_SIZE, scoutSprite, type ScoutLook } from "./scoutCompanion.ts";

export const SCOUT_STAGE_HEIGHT = 132;
export const SCOUT_CANVAS_LABEL = "Scout, your X Copilot companion";

const GROUND_INSET = 10;
const BLINK_EVERY_MS = 3_200;
const BLINK_MS = 140;
const BOB_MS = 520;
const PATROL_MS = 9_000;
const HOP_MS = 900;
const FALLBACK_WIDTH = 280;

export type ScoutPalette = {
  outline: string;
  body: string;
  highlight: string;
  ink: string;
  cheek: string;
  scarf: string;
  bulbOff: string;
  bulbOn: string;
  ground: string;
  sleep: string;
};

export const SCOUT_PALETTE: ScoutPalette = {
  outline: "#3d5f73",
  body: "#7eb8dc",
  highlight: "#b9dcf0",
  ink: "#161310",
  cheek: "#d9a441",
  scarf: "#d9a441",
  bulbOff: "#4d453c",
  bulbOn: "#7dba8a",
  ground: "#3a332c",
  sleep: "#a89f94",
};

export type ScoutMotion = { hopStartMs: number | null };

export type ScoutFrame = {
  width: number;
  height: number;
  palette: ScoutPalette;
  look: ScoutLook;
  motion: ScoutMotion;
  timeMs: number;
  still: boolean;
};

export type ScoutBrush = Pick<
  CanvasRenderingContext2D,
  "clearRect" | "fillRect" | "fillStyle" | "createRadialGradient"
>;

function cellColor(code: string, bulb: string, palette: ScoutPalette): string | null {
  if (code === "o" || code === "f") return palette.outline;
  if (code === "b") return palette.body;
  if (code === "h") return palette.highlight;
  if (code === "e" || code === "m") return palette.ink;
  if (code === "c") return palette.cheek;
  if (code === "s") return palette.scarf;
  if (code === "a") return bulb;
  return null;
}

function hopLift(motion: ScoutMotion, timeMs: number, cell: number): number {
  if (motion.hopStartMs === null) return 0;
  const progress = (timeMs - motion.hopStartMs) / HOP_MS;
  if (progress >= 1) {
    motion.hopStartMs = null;
    return 0;
  }
  return Math.round(Math.abs(Math.sin(progress * Math.PI)) * 4) * cell;
}

export function paintScout(ctx: ScoutBrush, frame: ScoutFrame): void {
  const { width, height, palette, look, motion, timeMs, still } = frame;
  const cell = look.cell;
  const size = SCOUT_SPRITE_SIZE * cell;
  const ground = height - GROUND_INSET;
  const roam = Math.max(0, (width - size) / 2 - cell * 4);
  const swing = look.awake && !still ? Math.sin((timeMs / PATROL_MS) * Math.PI * 2) : 0;
  const facingLeft = look.awake && !still && Math.cos((timeMs / PATROL_MS) * Math.PI * 2) < 0;
  const left = Math.round((width - size) / 2 + swing * roam);
  const bob = still ? 0 : Math.floor(timeMs / BOB_MS) % 2 === 0 ? 0 : look.awake ? cell : 0;
  const top = ground - size - bob - hopLift(motion, timeMs, cell);
  const pulse = still ? 1 : 0.75 + 0.25 * Math.sin(timeMs / 380);

  ctx.clearRect(0, 0, width, height);

  if (look.glow > 0) {
    const centerX = left + size / 2;
    const centerY = top + size / 2;
    const reach = Math.min(centerY, size * (0.8 + look.glow * 0.5));
    const aura = ctx.createRadialGradient(centerX, centerY, size * 0.2, centerX, centerY, reach);
    aura.addColorStop(0, `rgba(125, 186, 138, ${(0.38 * look.glow * pulse).toFixed(3)})`);
    aura.addColorStop(1, "rgba(125, 186, 138, 0)");
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, width, ground);
  }

  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, ground, width, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(left + cell * 3, ground + 1, size - cell * 6, 2);

  const bulb = look.glow > 0 && pulse > 0.7 ? palette.bulbOn : look.glow > 0 ? palette.outline : palette.bulbOff;
  const blink = !still && timeMs % BLINK_EVERY_MS < BLINK_MS;
  const rows = scoutSprite({ awake: look.awake, blink, scarf: look.scarf, bigBulb: look.bigBulb });
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = cellColor(row.charAt(facingLeft ? row.length - 1 - x : x), bulb, palette);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + x * cell, top + y * cell, cell, cell);
    }
  });

  for (let index = 0; index < look.sparkles; index += 1) {
    const phase = still ? 1 : Math.sin(timeMs / 260 + index * 1.7);
    if (phase < 0.2) continue;
    const angle = index * 2.4 + (still ? 0 : timeMs / 5_000);
    const reach = size * (0.62 + (index % 3) * 0.1);
    const x = Math.round(left + size / 2 + Math.cos(angle) * reach);
    const y = Math.round(top + size / 2 + Math.sin(angle) * reach * 0.7);
    if (y > ground - cell) continue;
    ctx.fillStyle = index % 2 === 0 ? palette.bulbOn : palette.cheek;
    ctx.fillRect(x - cell, y, cell * 3, cell);
    ctx.fillRect(x, y - cell, cell, cell * 3);
  }

  if (!look.awake) {
    const drift = still ? 0 : Math.floor(timeMs / 600) % 3;
    ctx.fillStyle = palette.sleep;
    const zx = left + size + cell;
    const zy = top - drift * cell;
    ctx.fillRect(zx, zy, cell * 3, cell);
    ctx.fillRect(zx + cell, zy + cell, cell, cell);
    ctx.fillRect(zx, zy + cell * 2, cell * 3, cell);
  }
}

export type ScoutStage = {
  show: (look: ScoutLook) => void;
  stop: () => void;
};

const IDLE_STAGE: ScoutStage = { show: () => {}, stop: () => {} };

export type ScoutStageBrush = ScoutBrush & {
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  imageSmoothingEnabled: boolean;
};

export type ScoutStageView = {
  devicePixelRatio: number;
  matchMedia?: (query: string) => { matches: boolean };
  requestAnimationFrame(callback: (timeMs: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  addEventListener(type: "resize", listener: () => void): void;
  removeEventListener(type: "resize", listener: () => void): void;
};

export type ScoutStageCanvas = {
  clientWidth: number;
  width: number;
  height: number;
  ownerDocument: { defaultView: ScoutStageView | null };
  getContext(kind: "2d"): ScoutStageBrush | null;
};

export function startScoutStage(
  canvas: ScoutStageCanvas,
  opts: { look: ScoutLook; height?: number; palette?: ScoutPalette },
): ScoutStage {
  const ctx = canvas.getContext("2d");
  const view = canvas.ownerDocument.defaultView;
  if (!ctx || !view) return IDLE_STAGE;
  const height = opts.height ?? SCOUT_STAGE_HEIGHT;
  const palette = opts.palette ?? SCOUT_PALETTE;
  const still = view.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const motion: ScoutMotion = { hopStartMs: null };
  let look = opts.look;
  let hopDue = false;
  let width = FALLBACK_WIDTH;
  let frame = 0;

  const fit = () => {
    const ratio = view.devicePixelRatio || 1;
    width = canvas.clientWidth || FALLBACK_WIDTH;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
  };
  const paint = (timeMs: number) => {
    if (hopDue) {
      hopDue = false;
      motion.hopStartMs = timeMs;
    }
    paintScout(ctx, { width, height, palette, look, motion, timeMs, still });
    if (!still) frame = view.requestAnimationFrame(paint);
  };
  const refit = () => {
    fit();
    if (still) paint(0);
  };

  fit();
  frame = view.requestAnimationFrame(paint);
  view.addEventListener("resize", refit);

  return {
    show(next) {
      if (next.repliesToday > look.repliesToday) hopDue = true;
      look = next;
      if (still) paint(0);
    },
    stop() {
      view.cancelAnimationFrame(frame);
      view.removeEventListener("resize", refit);
    },
  };
}
