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

export const BUBBLE_FILL = 0.42;
export const BUBBLE_GAP = 1.5;
export const BUBBLE_MAX_MEMBERS = 40;
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

export function bubbleMinRadius(box: BubbleBox): number {
  return Math.min(11, Math.max(5, Math.min(box.width, box.height) * 0.045));
}

function totalArea(radii: readonly number[]): number {
  return radii.reduce((sum, r) => sum + Math.PI * r * r, 0);
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
  const cap = Math.max(rMin, Math.min(box.width, box.height) * 0.2);
  const budget = BUBBLE_FILL * box.width * box.height;
  const fits = (rMax: number): boolean => {
    const self = Math.min(rMax * 1.25, Math.min(box.width, box.height) * 0.4);
    return Math.PI * self * self + totalArea(radiiFor(scores, rMin, rMax)) <= budget;
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
    self: Math.max(rMin, Math.min(lo * 1.25, Math.min(box.width, box.height) * 0.4)),
    members: radiiFor(scores, rMin, lo),
  };
}

function stretch(box: BubbleBox): number {
  return Math.min(1.8, Math.max(0.6, Math.sqrt(box.width / box.height)));
}

function seedBodies(scores: readonly number[], box: BubbleBox): Body[] {
  const radii = bubbleRadii(scores, box);
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
    const ringRadius = outer + radii.members[index]! + BUBBLE_GAP;
    const offset = ring * 0.9;
    let used = 0;
    let widest = 0;
    let placed = 0;
    while (index < radii.members.length) {
      const r = radii.members[index]!;
      const half = 2 * Math.asin(Math.min(1, (r + BUBBLE_GAP / 2) / ringRadius));
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
    outer = ringRadius + widest + BUBBLE_GAP;
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
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      const a = bodies[i]!;
      for (let j = i + 1; j < bodies.length; j++) {
        const b = bodies[j]!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        const min = a.r + b.r + BUBBLE_GAP;
        if (dist >= min) continue;
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
  const before = bodies.map((b) => ({ x: b.x, y: b.y }));
  bodies.forEach((body, i) => {
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
    const prev = before[i]!;
    if (i === dragged) {
      body.vx = 0;
      body.vy = 0;
      return;
    }
    body.vx = body.x - prev.x;
    body.vy = body.y - prev.y;
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

export function retargetBodies(
  bodies: readonly Body[],
  scores: readonly number[],
  from: BubbleBox,
  to: BubbleBox,
): Body[] {
  const target = packBubbles(scores, to);
  const kx = from.width > 0 ? to.width / from.width : 1;
  const ky = from.height > 0 ? to.height / from.height : 1;
  return target.map((goal, i) => {
    const prev = bodies[i];
    if (!prev) return goal;
    return {
      ...goal,
      x: prev.x * kx,
      y: prev.y * ky,
      r: prev.r,
    };
  });
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
