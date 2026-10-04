import { SCOUT_SPRITE_SIZE, scoutSprite, type ScoutLook } from "./scoutCompanion.ts";
import {
  scoutArriveRun,
  scoutHostWeight,
  scoutLeaveRun,
  scoutSpeaker,
  scoutVisitorStep,
  SCOUT_VISIT_BACK_AT_MS,
  SCOUT_VISIT_EXIT_AT_MS,
  SCOUT_VISIT_GREET_AT_MS,
  SCOUT_VISIT_GREET_MS,
  SCOUT_VISIT_IN_AT_MS,
  SCOUT_VISIT_TOTAL_MS,
  type ScoutVisitSide,
} from "./scoutVisit.ts";

export const SCOUT_STAGE_HEIGHT = 132;
export const SCOUT_CANVAS_LABEL = "Scout, your X Copilot companion";

export const SCOUT_GROUND_INSET = 10;
export const SCOUT_SHADOW_DEPTH = 3;
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

export const SCOUT_DESK_PALETTE: ScoutPalette = {
  outline: "#a86a2c",
  body: "#d4a574",
  highlight: "#f4eee6",
  ink: "#161310",
  cheek: "#7eb8dc",
  scarf: "#7eb8dc",
  bulbOff: "#4d453c",
  bulbOn: "#7dba8a",
  ground: "#3a332c",
  sleep: "#a89f94",
};

export type ScoutVisitState =
  | { role: "depart"; side: ScoutVisitSide; elapsedMs: number }
  | { role: "host"; guest: ScoutPalette; entry: ScoutVisitSide; elapsedMs: number };

export type ScoutMotion = { hopStartMs: number | null };

export type ScoutFrame = {
  width: number;
  height: number;
  palette: ScoutPalette;
  look: ScoutLook;
  motion: ScoutMotion;
  timeMs: number;
  still: boolean;
  visit?: ScoutVisitState | null;
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

type Pose = { left: number; facingLeft: boolean; lift: number; hidden: boolean };

type PatrolAt = (timeMs: number) => Pose;

function ease(progress: number): number {
  return progress * progress * (3 - 2 * progress);
}

function mix(from: number, to: number, progress: number): number {
  return Math.round(from + (to - from) * ease(progress));
}

function runLift(hop: number, cell: number): number {
  return Math.round(hop * 3) * cell;
}

function greetLift(progress: number, cell: number): number {
  return Math.round(Math.sin(progress * Math.PI) * 3) * cell;
}

function offStage(left: number, width: number, size: number): boolean {
  return left + size * 3 <= 0 || left - size * 2 >= width;
}

function departPose(
  visit: Extract<ScoutVisitState, { role: "depart" }>,
  patrolAt: PatrolAt,
  timeMs: number,
  width: number,
  size: number,
  cell: number,
): Pose {
  const startMs = timeMs - visit.elapsedMs;
  const toLeft = visit.side === "left";
  if (visit.elapsedMs < SCOUT_VISIT_BACK_AT_MS) {
    const start = patrolAt(startMs).left;
    const run = scoutLeaveRun(visit.elapsedMs, toLeft ? start : width - size - start);
    const left = Math.round(toLeft ? start - run.offset : start + run.offset);
    return { left, facingLeft: toLeft, lift: runLift(run.hop, cell), hidden: offStage(left, width, size) };
  }
  const home = patrolAt(startMs + SCOUT_VISIT_TOTAL_MS).left;
  const run = scoutArriveRun(visit.elapsedMs - SCOUT_VISIT_BACK_AT_MS, toLeft ? home + size : width - home, size);
  const left = Math.round(toLeft ? run.offset - size : width - run.offset);
  return { left, facingLeft: !toLeft, lift: runLift(run.hop, cell), hidden: offStage(left, width, size) };
}

function hostSpots(width: number, size: number, cell: number, entry: ScoutVisitSide) {
  const mid = width / 2;
  const nearEdge = Math.round(entry === "right" ? mid + cell : mid - size - cell);
  const farEdge = Math.round(entry === "right" ? mid - size - cell : mid + cell);
  const clamp = (left: number) => Math.max(0, Math.min(width - size, left));
  return { guest: clamp(nearEdge), resident: clamp(farEdge) };
}

function guestPose(
  visit: Extract<ScoutVisitState, { role: "host" }>,
  spot: number,
  width: number,
  size: number,
  cell: number,
): Pose | null {
  const { elapsedMs } = visit;
  if (elapsedMs < SCOUT_VISIT_IN_AT_MS || elapsedMs >= SCOUT_VISIT_TOTAL_MS) return null;
  const fromRight = visit.entry === "right";
  if (elapsedMs < SCOUT_VISIT_GREET_AT_MS) {
    const run = scoutArriveRun(elapsedMs - SCOUT_VISIT_IN_AT_MS, fromRight ? width - spot : spot + size, size);
    const left = Math.round(fromRight ? width - run.offset : run.offset - size);
    return { left, facingLeft: fromRight, lift: runLift(run.hop, cell), hidden: false };
  }
  if (elapsedMs < SCOUT_VISIT_EXIT_AT_MS) {
    const progress = (elapsedMs - SCOUT_VISIT_GREET_AT_MS) / SCOUT_VISIT_GREET_MS;
    const lift = progress < 0.5 ? greetLift(progress * 2, cell) : 0;
    return { left: spot, facingLeft: fromRight, lift, hidden: false };
  }
  const run = scoutLeaveRun(elapsedMs - SCOUT_VISIT_EXIT_AT_MS, fromRight ? width - spot - size : spot);
  const left = Math.round(fromRight ? spot + run.offset : spot - run.offset);
  return { left, facingLeft: !fromRight, lift: runLift(run.hop, cell), hidden: offStage(left, width, size) };
}

function residentHostPose(
  visit: Extract<ScoutVisitState, { role: "host" }>,
  patrol: Pose,
  restLeft: number,
  cell: number,
): Pose {
  const weight = scoutHostWeight(visit.elapsedMs);
  if (weight === 0) return patrol;
  const step = scoutVisitorStep(visit.elapsedMs);
  const greeting = step.name === "greet" && step.progress >= 0.5;
  return {
    left: mix(patrol.left, restLeft, weight),
    facingLeft: weight === 1 ? visit.entry === "left" : patrol.facingLeft,
    lift: greeting ? greetLift((step.progress - 0.5) * 2, cell) : 0,
    hidden: false,
  };
}

const BUBBLE_UNIT = 2;
const BUBBLE_ROWS: readonly string[] = [
  "ooooooooo",
  "offfffffo",
  "ofkfffkfo",
  "ofkfffffo",
  "ofkkkfkfo",
  "ofkfkfkfo",
  "ofkfkfkfo",
  "offfffffo",
  "ooooooooo",
  "....o....",
  "....o....",
];

function drawBubble(ctx: ScoutBrush, speaker: ScoutPalette, centerX: number, bottomY: number): void {
  const width = (BUBBLE_ROWS[0]?.length ?? 0) * BUBBLE_UNIT;
  const left = Math.round(centerX - width / 2);
  const top = Math.max(0, bottomY - BUBBLE_ROWS.length * BUBBLE_UNIT);
  BUBBLE_ROWS.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const code = row.charAt(x);
      if (code === ".") continue;
      ctx.fillStyle = code === "o" ? speaker.outline : code === "k" ? speaker.ink : speaker.highlight;
      ctx.fillRect(left + x * BUBBLE_UNIT, top + y * BUBBLE_UNIT, BUBBLE_UNIT, BUBBLE_UNIT);
    }
  });
}

type Figure = { left: number; top: number; facingLeft: boolean; palette: ScoutPalette };

type Scene = {
  ctx: ScoutBrush;
  look: ScoutLook;
  timeMs: number;
  still: boolean;
  width: number;
  ground: number;
  size: number;
  pulse: number;
  blink: boolean;
};

function drawAura(scene: Scene, figure: Figure): void {
  const { ctx, look, width, ground, size, pulse } = scene;
  if (look.glow <= 0) return;
  const centerX = figure.left + size / 2;
  const centerY = figure.top + size / 2;
  const reach = Math.min(centerY, size * (0.8 + look.glow * 0.5));
  const aura = ctx.createRadialGradient(centerX, centerY, size * 0.2, centerX, centerY, reach);
  aura.addColorStop(0, `rgba(125, 186, 138, ${(0.38 * look.glow * pulse).toFixed(3)})`);
  aura.addColorStop(1, "rgba(125, 186, 138, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, ground);
}

function drawBody(scene: Scene, figure: Figure): void {
  const { ctx, look, timeMs, still, ground, size, pulse, blink } = scene;
  const { left, top, facingLeft, palette } = figure;
  const cell = look.cell;
  const bulb = look.glow > 0 && pulse > 0.7 ? palette.bulbOn : look.glow > 0 ? palette.outline : palette.bulbOff;
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(left + cell * 3, ground + 1, size - cell * 6, SCOUT_SHADOW_DEPTH - 1);
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

export function paintScout(ctx: ScoutBrush, frame: ScoutFrame): void {
  const { width, height, palette, look, motion, timeMs, still } = frame;
  const visit = still ? null : (frame.visit ?? null);
  const cell = look.cell;
  const size = SCOUT_SPRITE_SIZE * cell;
  const ground = height - SCOUT_GROUND_INSET;
  const roam = Math.max(0, (width - size) / 2 - cell * 4);
  const moving = look.awake && !still;
  const patrolAt: PatrolAt = (atMs) => ({
    left: Math.round((width - size) / 2 + (moving ? Math.sin((atMs / PATROL_MS) * Math.PI * 2) : 0) * roam),
    facingLeft: moving && Math.cos((atMs / PATROL_MS) * Math.PI * 2) < 0,
    lift: 0,
    hidden: false,
  });
  const patrol = patrolAt(timeMs);
  const spots = visit?.role === "host" ? hostSpots(width, size, cell, visit.entry) : null;
  let pose = patrol;
  if (visit?.role === "depart") pose = departPose(visit, patrolAt, timeMs, width, size, cell);
  if (visit?.role === "host" && spots) pose = residentHostPose(visit, patrol, spots.resident, cell);
  const bob = still || visit?.role === "depart" ? 0 : Math.floor(timeMs / BOB_MS) % 2 === 0 ? 0 : look.awake ? cell : 0;
  const top = ground - size - bob - hopLift(motion, timeMs, cell) - pose.lift;
  const scene: Scene = {
    ctx,
    look,
    timeMs,
    still,
    width,
    ground,
    size,
    pulse: still ? 1 : 0.75 + 0.25 * Math.sin(timeMs / 380),
    blink: !still && timeMs % BLINK_EVERY_MS < BLINK_MS,
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, ground, width, 1);

  const guest = visit?.role === "host" && spots ? guestPose(visit, spots.guest, width, size, cell) : null;
  const guestBob = guest && visit && scoutVisitorStep(visit.elapsedMs).name === "greet" ? bob : 0;
  const guestTop = ground - size - guestBob - (guest?.lift ?? 0);

  const figures: Figure[] = [];
  if (!pose.hidden) figures.push({ left: pose.left, top, facingLeft: pose.facingLeft, palette });
  if (visit?.role === "host" && guest && !guest.hidden) {
    figures.push({ left: guest.left, top: guestTop, facingLeft: guest.facingLeft, palette: visit.guest });
  }
  figures.forEach((figure) => drawAura(scene, figure));
  figures.forEach((figure) => drawBody(scene, figure));

  if (visit?.role === "host" && guest) {
    const speaker = scoutSpeaker(scoutVisitorStep(visit.elapsedMs));
    if (speaker === "guest") drawBubble(ctx, visit.guest, guest.left + size / 2, guestTop - cell);
    if (speaker === "resident") drawBubble(ctx, palette, pose.left + size / 2, top - cell);
  }
}

export type ScoutStage = {
  show: (look: ScoutLook) => void;
  cheer: () => void;
  depart: (side: ScoutVisitSide) => boolean;
  host: (guest: ScoutPalette, entry: ScoutVisitSide) => boolean;
  stop: () => void;
};

const IDLE_STAGE: ScoutStage = { show: () => {}, cheer: () => {}, depart: () => false, host: () => false, stop: () => {} };

type ScoutVisitPlan =
  | { role: "depart"; side: ScoutVisitSide }
  | { role: "host"; guest: ScoutPalette; entry: ScoutVisitSide };

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
  let plan: ScoutVisitPlan | null = null;
  let planStartMs: number | null = null;
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
    if (plan && planStartMs === null) planStartMs = timeMs;
    const elapsedMs = planStartMs === null ? 0 : timeMs - planStartMs;
    if (plan && elapsedMs >= SCOUT_VISIT_TOTAL_MS) {
      plan = null;
      planStartMs = null;
    }
    const visit: ScoutVisitState | null = plan ? { ...plan, elapsedMs } : null;
    paintScout(ctx, { width, height, palette, look, motion, timeMs, still, visit });
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
    cheer() {
      if (look.awake && !still) hopDue = true;
    },
    depart(side) {
      if (still || plan || !look.awake) return false;
      plan = { role: "depart", side };
      return true;
    },
    host(guest, entry) {
      if (still || plan || !look.awake) return false;
      plan = { role: "host", guest, entry };
      return true;
    },
    stop() {
      view.cancelAnimationFrame(frame);
      view.removeEventListener("resize", refit);
    },
  };
}
