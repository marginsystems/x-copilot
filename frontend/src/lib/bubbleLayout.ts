export type BubbleBox = { width: number; height: number };

export type Body = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  tr: number;
  hx: number;
  hy: number;
  pull: number;
  self: boolean;
};

export const BUBBLE_FILL = 0.52;
export const BUBBLE_MAX_MEMBERS = 40;
export const BUBBLE_COMPACT_MEMBERS = 20;
export const BUBBLE_SELF_SCALE = 1.5;
export const BUBBLE_MORPH_MS = 300;
export const BUBBLE_ENTER_SCALE = 0.4;
const LEAVE_FADE_SPEED = 1.8;
export const BUBBLE_SETTLE_SPEED = 0.03;
export const BUBBLE_PACK_STEPS = 1500;

const GOLDEN_ANGLE = 2.399963229728653;
const PULL = 0.004;
const HOME_SPRING = 0.05;
const SELF_HOME_SPRING = 0.2;
const DAMPING = 0.82;
const RADIUS_EASE = 0.2;
const SELF_WEIGHT = 0.04;
const PROJECTION_PASSES = 8;

export function memberLimit(expanded: boolean): number {
  return expanded ? BUBBLE_MAX_MEMBERS : BUBBLE_COMPACT_MEMBERS;
}

export function bubbleGap(box: BubbleBox): number {
  return Math.min(4, Math.max(2.5, Math.min(box.width, box.height) * 0.016));
}

export function bubbleMinRadius(box: BubbleBox): number {
  return Math.min(11, Math.max(5, Math.min(box.width, box.height) * 0.045));
}

function totalArea(radii: readonly number[], pad: number): number {
  return radii.reduce((sum, r) => sum + Math.PI * (r + pad) * (r + pad), 0);
}

function radiiFor(scores: readonly number[], rMin: number, rMax: number): number[] {
  const top = scores.reduce((best, s) => Math.max(best, s), 0);
  return scores.map((s) => {
    const t = top > 0 ? Math.sqrt(Math.max(0, s) / top) : 1;
    return rMin + (rMax - rMin) * t;
  });
}

export function bubbleRadii(
  scores: readonly number[],
  box: BubbleBox,
): { self: number; members: number[] } {
  const rMin = bubbleMinRadius(box);
  const short = Math.min(box.width, box.height);
  const cap = Math.max(rMin, short * 0.2);
  const pad = bubbleGap(box) / 2;
  const budget = BUBBLE_FILL * box.width * box.height;
  const selfFor = (rMax: number): number => Math.min(rMax * BUBBLE_SELF_SCALE, short * 0.36);
  const fits = (rMax: number): boolean => {
    const self = selfFor(rMax) + pad;
    return Math.PI * self * self + totalArea(radiiFor(scores, rMin, rMax), pad) <= budget;
  };
  let lo = rMin;
  let hi = cap;
  if (fits(hi)) lo = hi;
  else {
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) lo = mid;
      else hi = mid;
    }
  }
  return {
    self: Math.max(rMin, selfFor(lo)),
    members: radiiFor(scores, rMin, lo),
  };
}

function stretch(box: BubbleBox): number {
  return Math.min(1.8, Math.max(0.6, Math.sqrt(box.width / box.height)));
}

function seedBodies(scores: readonly number[], box: BubbleBox): Body[] {
  const radii = bubbleRadii(scores, box);
  const gap = bubbleGap(box);
  const cx = box.width / 2;
  const cy = box.height / 2;
  const sx = stretch(box);
  const sy = 1 / sx;
  const count = scores.length;
  const bodies: Body[] = [
    { x: cx, y: cy, vx: 0, vy: 0, r: radii.self, tr: radii.self, hx: cx, hy: cy, pull: 1, self: true },
  ];
  let outer = radii.self;
  let index = 0;
  let ring = 0;
  while (index < radii.members.length) {
    const ringRadius = outer + radii.members[index]! + gap;
    const offset = ring * 0.9;
    let used = 0;
    let widest = 0;
    let placed = 0;
    while (index < radii.members.length) {
      const r = radii.members[index]!;
      const half = 2 * Math.asin(Math.min(1, (r + gap / 2) / ringRadius));
      if (placed > 0 && used + 2 * half > Math.PI * 2) break;
      const angle = offset + used + half;
      const x = cx + Math.cos(angle) * ringRadius * sx;
      const y = cy + Math.sin(angle) * ringRadius * sy;
      bodies.push({
        x,
        y,
        vx: 0,
        vy: 0,
        r,
        tr: r,
        hx: x,
        hy: y,
        pull: 1 + 3 * (1 - index / Math.max(1, count)),
        self: false,
      });
      used += 2 * half;
      widest = Math.max(widest, r);
      placed += 1;
      index += 1;
    }
    outer = ringRadius + widest + gap;
    ring += 1;
  }
  return bodies;
}

function weight(body: Body, dragged: boolean): number {
  if (dragged) return 0;
  return (body.self ? SELF_WEIGHT : 1) / (body.r * body.r);
}

function project(
  bodies: Body[],
  box: BubbleBox,
  dragged: number,
  passes: number,
): void {
  const gap = bubbleGap(box);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        const min = a.r + b.r + gap;
        const squared = dx * dx + dy * dy;
        if (squared >= min * min) continue;
        let dist = Math.sqrt(squared);
        if (dist < 1e-6) {
          const angle = (i * 7 + j) * GOLDEN_ANGLE;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1;
        }
        const wa = weight(a, i === dragged);
        const wb = weight(b, j === dragged);
        const total = wa + wb;
        if (total === 0) continue;
        const push = min - dist;
        const nx = dx / dist;
        const ny = dy / dist;
        a.x -= nx * push * (wa / total);
        a.y -= ny * push * (wa / total);
        b.x += nx * push * (wb / total);
        b.y += ny * push * (wb / total);
      }
    }
    for (const body of bodies) {
      body.x = Math.min(Math.max(body.x, body.r), Math.max(body.r, box.width - body.r));
      body.y = Math.min(Math.max(body.y, body.r), Math.max(body.r, box.height - body.r));
    }
  }
}

export function stepBodies(
  bodies: Body[],
  box: BubbleBox,
  options: { dragged?: number; homeSpring?: boolean } = {},
): number {
  const dragged = options.dragged ?? -1;
  const homeSpring = options.homeSpring ?? true;
  const cx = box.width / 2;
  const cy = box.height / 2;
  const sx = stretch(box);
  const kx = PULL / (sx * sx);
  const ky = PULL * sx * sx;
  const before = new Float64Array(bodies.length * 2);
  bodies.forEach((body, i) => {
    before[i * 2] = body.x;
    before[i * 2 + 1] = body.y;
    if (Math.abs(body.tr - body.r) > 0.02) body.r += (body.tr - body.r) * RADIUS_EASE;
    else body.r = body.tr;
    if (i === dragged) return;
    let ax = 0;
    let ay = 0;
    if (body.self) {
      ax = (body.hx - body.x) * SELF_HOME_SPRING;
      ay = (body.hy - body.y) * SELF_HOME_SPRING;
    } else {
      ax = (cx - body.x) * kx * body.pull;
      ay = (cy - body.y) * ky * body.pull;
      if (homeSpring) {
        ax += (body.hx - body.x) * HOME_SPRING;
        ay += (body.hy - body.y) * HOME_SPRING;
      }
    }
    body.vx = (body.vx + ax) * DAMPING;
    body.vy = (body.vy + ay) * DAMPING;
    body.x += body.vx;
    body.y += body.vy;
  });
  project(bodies, box, dragged, PROJECTION_PASSES);
  let fastest = 0;
  bodies.forEach((body, i) => {
    if (i === dragged) {
      body.vx = 0;
      body.vy = 0;
      return;
    }
    body.vx = body.x - before[i * 2]!;
    body.vy = body.y - before[i * 2 + 1]!;
    fastest = Math.max(fastest, Math.hypot(body.vx, body.vy));
  });
  return fastest;
}

export function isSettled(bodies: readonly Body[], fastest: number): boolean {
  return fastest < BUBBLE_SETTLE_SPEED && bodies.every((b) => b.r === b.tr);
}

export function packBubbles(scores: readonly number[], box: BubbleBox): Body[] {
  const bodies = seedBodies(scores.slice(0, BUBBLE_MAX_MEMBERS), box);
  for (let step = 0; step < BUBBLE_PACK_STEPS; step++) {
    const fastest = stepBodies(bodies, box, { homeSpring: false });
    if (fastest < BUBBLE_SETTLE_SPEED / 15) break;
  }
  for (const body of bodies) {
    body.vx = 0;
    body.vy = 0;
    body.hx = body.x;
    body.hy = body.y;
  }
  return bodies;
}

export function settleSteps(bodies: Body[], box: BubbleBox, limit: number, dragged = -1): number {
  for (let step = 1; step <= limit; step++) {
    if (isSettled(bodies, stepBodies(bodies, box, { dragged }))) return step;
  }
  return limit;
}

export function adoptRest(bodies: Body[]): void {
  for (const body of bodies) {
    body.hx = body.x;
    body.hy = body.y;
    body.vx = 0;
    body.vy = 0;
  }
}

export const REPACK_ASPECT_CHANGE = 0.2;

export function shouldRepack(from: BubbleBox, to: BubbleBox): boolean {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return true;
  const change = Math.abs(Math.log(to.width / to.height / (from.width / from.height)));
  return change > REPACK_ASPECT_CHANGE;
}

export function rescaleBodies(bodies: Body[], from: BubbleBox, to: BubbleBox): void {
  const kx = to.width / from.width;
  const ky = to.height / from.height;
  const k = Math.min(kx, ky);
  for (const body of bodies) {
    body.x *= kx;
    body.y *= ky;
    body.hx *= kx;
    body.hy *= ky;
    body.tr *= k;
  }
}

export function snapToHome(bodies: Body[]): void {
  for (const body of bodies) {
    body.x = body.hx;
    body.y = body.hy;
    body.vx = 0;
    body.vy = 0;
    body.r = body.tr;
  }
}

export function hitBody(bodies: readonly Body[], x: number, y: number, slop = 0): number {
  let best = -1;
  let bestDist = Infinity;
  bodies.forEach((body, i) => {
    const dist = Math.hypot(x - body.x, y - body.y);
    if (dist <= body.r + slop && dist - body.r < bestDist) {
      best = i;
      bestDist = dist - body.r;
    }
  });
  return best;
}

export function overlapDepth(bodies: readonly Body[]): number {
  let worst = 0;
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i]!;
      const b = bodies[j]!;
      worst = Math.max(worst, a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y));
    }
  }
  return worst;
}

export type Pose = { x: number; y: number; r: number; a: number };
export type KeyedPose = { key: string; pose: Pose };
export type MorphEntry = { key: string; from: Pose; to: Pose; fromIndex: number; toIndex: number };

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

export function containScale(from: BubbleBox, to: BubbleBox): number {
  if (from.width <= 0 || from.height <= 0) return 1;
  return Math.min(1, to.width / from.width, to.height / from.height);
}

export function planMorph(
  from: readonly KeyedPose[],
  fromBox: BubbleBox,
  to: readonly KeyedPose[],
  toBox: BubbleBox,
): MorphEntry[] {
  const k = containScale(fromBox, toBox);
  const mapPose = (pose: Pose): Pose => ({
    x: toBox.width / 2 + (pose.x - fromBox.width / 2) * k,
    y: toBox.height / 2 + (pose.y - fromBox.height / 2) * k,
    r: pose.r * k,
    a: pose.a,
  });
  const fromIndex = new Map(from.map((item, i) => [item.key, i]));
  const toKeys = new Set(to.map((item) => item.key));
  const entries: MorphEntry[] = to.map((item, i) => {
    const source = fromIndex.get(item.key);
    if (source === undefined) {
      return {
        key: item.key,
        from: { ...item.pose, r: item.pose.r * BUBBLE_ENTER_SCALE, a: 0 },
        to: item.pose,
        fromIndex: -1,
        toIndex: i,
      };
    }
    return {
      key: item.key,
      from: mapPose(from[source]!.pose),
      to: item.pose,
      fromIndex: source,
      toIndex: i,
    };
  });
  from.forEach((item, i) => {
    if (toKeys.has(item.key)) return;
    const start = mapPose(item.pose);
    entries.push({
      key: item.key,
      from: start,
      to: { ...start, r: start.r * BUBBLE_ENTER_SCALE, a: 0 },
      fromIndex: i,
      toIndex: -1,
    });
  });
  return entries;
}

export function morphPose(entry: MorphEntry, progress: number): Pose {
  const t = easeOutCubic(progress);
  const lerp = (a: number, b: number) => a + (b - a) * t;
  return {
    x: lerp(entry.from.x, entry.to.x),
    y: lerp(entry.from.y, entry.to.y),
    r: lerp(entry.from.r, entry.to.r),
    a:
      entry.toIndex < 0
        ? entry.from.a + (entry.to.a - entry.from.a) * easeOutCubic(progress * LEAVE_FADE_SPEED)
        : lerp(entry.from.a, entry.to.a),
  };
}

export function isStill(entries: readonly MorphEntry[], tolerance = 0.05): boolean {
  return entries.every(
    (entry) =>
      entry.fromIndex >= 0 &&
      entry.toIndex >= 0 &&
      Math.abs(entry.from.x - entry.to.x) <= tolerance &&
      Math.abs(entry.from.y - entry.to.y) <= tolerance &&
      Math.abs(entry.from.r - entry.to.r) <= tolerance &&
      Math.abs(entry.from.a - entry.to.a) <= tolerance,
  );
}
