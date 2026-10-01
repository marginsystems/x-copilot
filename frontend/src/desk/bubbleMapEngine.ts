import {
  BUBBLE_MAX_MEMBERS,
  BUBBLE_MORPH_MS,
  adoptRest,
  hitBody,
  isSettled,
  isStill,
  memberLimit,
  morphPose,
  packBubbles,
  planMorph,
  rescaleBodies,
  shouldRepack,
  snapToHome,
  stepBodies,
  type Body,
  type BubbleBox,
  type KeyedPose,
  type MorphEntry,
} from "../lib/bubbleLayout";
import {
  GHOST_SCORES,
  memberDetail,
  memberInitial,
  memberScore,
} from "../lib/circleLeaderboard";
import type { CircleSharePayload } from "../lib/circleShare";

export type BubbleImages = Map<string, CanvasImageSource | null>;

export type BubbleMapHooks = {
  onHover: (handle: string | null) => void;
};

export type BubbleMapEngine = {
  setData: (payload: CircleSharePayload | null, images: BubbleImages | null) => void;
  setHighlight: (handle: string | null) => void;
  setExpanded: (expanded: boolean) => void;
  positions: () => Array<{ x: number; y: number; r: number }>;
  destroy: () => void;
};

type Person = {
  handle: string | null;
  name: string | null;
  detail: string;
  image: CanvasImageSource | null;
  initial: string;
  self: boolean;
};

type Morph = {
  entries: MorphEntry[];
  persons: Array<Person | null>;
  progress: number;
  start: number | null;
};

type Snapshot = {
  box: BubbleBox;
  items: Array<KeyedPose & { person: Person | null }>;
};

type Colors = {
  panel: string;
  border: string;
  borderStrong: string;
  text: string;
  accent: string;
  fontHead: string;
};

type Drag = {
  id: number;
  index: number;
  startX: number;
  startY: number;
  offsetX: number;
  offsetY: number;
  moved: boolean;
  threshold: number;
};

const STEP_MS = 1000 / 60;
const MAX_STEPS_PER_FRAME = 4;
const JAM_DISTANCE = 1.5;
const TIP_GAP = 8;
const TIP_MARGIN = 4;
const PACK_CACHE_SIZE = 6;
const VISIBLE_ALPHA = 0.02;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readColors(canvas: HTMLCanvasElement): Colors {
  const style = getComputedStyle(canvas);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    panel: read("--panel", "#1f1b17"),
    border: read("--border", "#3a332c"),
    borderStrong: read("--border-strong", "#4d453c"),
    text: read("--text", "#f4eee6"),
    accent: read("--accent", "#7eb8dc"),
    fontHead: read("--font-head", "sans-serif"),
  };
}

function buildPeople(
  payload: CircleSharePayload,
  images: BubbleImages | null,
): { people: Person[]; scores: number[] } {
  const image = (url: string | null) => (url ? (images?.get(url) ?? null) : null);
  const members = payload.members.slice(0, BUBBLE_MAX_MEMBERS);
  const people: Person[] = [
    {
      handle: payload.handle,
      name: payload.name,
      detail: "You",
      image: image(payload.avatarUrl),
      initial: memberInitial(payload.handle ?? "", payload.name),
      self: true,
    },
    ...members.map((m) => ({
      handle: m.handle,
      name: m.name,
      detail: memberDetail(m),
      image: image(m.avatarUrl),
      initial: memberInitial(m.handle, m.name),
      self: false,
    })),
  ];
  return { people, scores: members.map((m) => Math.max(1, memberScore(m))) };
}

function drawSource(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  x: number,
  y: number,
  r: number,
): void {
  if (typeof HTMLImageElement !== "undefined" && image instanceof HTMLImageElement) {
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (side > 0) {
      const sx = (image.naturalWidth - side) / 2;
      const sy = (image.naturalHeight - side) / 2;
      ctx.drawImage(image, sx, sy, side, side, x - r, y - r, r * 2, r * 2);
      return;
    }
  }
  ctx.drawImage(image, x - r, y - r, r * 2, r * 2);
}

export function createBubbleMap(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  hooks: BubbleMapHooks,
): BubbleMapEngine {
  const ctx = canvas.getContext("2d");
  const tip = document.createElement("div");
  tip.className = "desk-circle-tip";
  tip.hidden = true;
  tip.setAttribute("aria-hidden", "true");
  host.appendChild(tip);

  let colors = readColors(canvas);
  let roster: Person[] = [];
  let rosterScores: number[] = [];
  let people: Person[] = [];
  let scores: number[] = [];
  let keys: string[] = [];
  let expanded = false;
  let morph: Morph | null = null;
  const packCache = new Map<string, Body[]>();
  let bodies: Body[] = [];
  let ghost = true;
  let box: BubbleBox = { width: 0, height: 0 };
  let dpr = 1;
  let hovered = -1;
  let linked = -1;
  let drag: Drag | null = null;
  let running = false;
  let raf = 0;
  let drawRaf = 0;
  let lastTime = 0;
  let accumulator = 0;
  let lastFastest = Infinity;
  let docVisible = typeof document === "undefined" || document.visibilityState !== "hidden";
  let onscreen = true;
  let tipWidth = 0;
  let tipHeight = 0;
  let destroyed = false;

  const reducedQuery =
    typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  const schemeQuery =
    typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  const reduced = () => reducedQuery?.matches === true;
  const hasBox = () => box.width > 0 && box.height > 0;
  const canRun = () => !destroyed && ctx !== null && docVisible && onscreen && hasBox();
  const dragging = () => drag !== null && drag.moved;

  function personKey(person: Person, index: number): string {
    return person.self ? "self" : (person.handle ?? `#${index}`);
  }

  function derive(): void {
    const limit = memberLimit(expanded);
    people = roster.slice(0, limit + 1);
    scores = rosterScores.slice(0, limit);
    keys = people.map(personKey);
  }

  function packCached(source: readonly number[]): Body[] {
    const id = `${box.width}x${box.height}:${source.join(",")}`;
    const hit = packCache.get(id);
    if (hit) return hit.map((body) => ({ ...body }));
    const packed = packBubbles(source, box);
    packCache.set(id, packed.map((body) => ({ ...body })));
    if (packCache.size > PACK_CACHE_SIZE) {
      for (const oldest of packCache.keys()) {
        packCache.delete(oldest);
        break;
      }
    }
    return packed;
  }

  function snapshot(): Snapshot | null {
    if (ghost || !hasBox()) return null;
    const frozen = { width: box.width, height: box.height };
    if (morph) {
      const live = morph;
      const items = live.entries
        .map((entry, i) => ({
          key: entry.key,
          pose: morphPose(entry, live.progress),
          person: live.persons[i] ?? null,
        }))
        .filter((item) => item.pose.a > VISIBLE_ALPHA);
      return { box: frozen, items };
    }
    if (bodies.length === 0 || bodies.length !== people.length) return null;
    return {
      box: frozen,
      items: bodies.map((body, i) => ({
        key: keys[i]!,
        pose: { x: body.x, y: body.y, r: body.r, a: 1 },
        person: people[i] ?? null,
      })),
    };
  }

  function indexOfHandle(handle: string | null): number {
    if (!handle || ghost) return -1;
    return people.findIndex((p) => !p.self && p.handle === handle);
  }

  function placeTip(): void {
    if (tip.hidden || hovered < 0) return;
    const body = bodies[hovered];
    if (!body) return;
    const left = clamp(body.x - tipWidth / 2, TIP_MARGIN, box.width - tipWidth - TIP_MARGIN);
    let top = body.y - body.r - TIP_GAP - tipHeight;
    if (top < TIP_MARGIN) top = body.y + body.r + TIP_GAP;
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(clamp(top, TIP_MARGIN, box.height - tipHeight - TIP_MARGIN))}px)`;
  }

  function showTip(index: number): void {
    const person = people[index];
    if (!person || ghost) {
      tip.hidden = true;
      return;
    }
    tip.replaceChildren();
    const lines: Array<[string, string]> = [];
    if (person.name) lines.push(["desk-circle-tip-name", person.name]);
    if (person.handle) lines.push(["desk-circle-tip-handle", `@${person.handle}`]);
    if (person.detail) lines.push(["desk-circle-tip-detail", person.detail]);
    for (const [className, text] of lines) {
      const line = document.createElement("span");
      line.className = className;
      line.textContent = text;
      tip.appendChild(line);
    }
    tip.hidden = false;
    tipWidth = tip.offsetWidth;
    tipHeight = tip.offsetHeight;
    placeTip();
  }

  type DrawItem = { x: number; y: number; r: number; a: number; person: Person | null };

  function drawItems(): DrawItem[] {
    if (morph) {
      const live = morph;
      return live.entries.map((entry, i) => {
        const pose = morphPose(entry, live.progress);
        return { ...pose, person: live.persons[i] ?? null };
      });
    }
    return bodies.map((body, i) => ({
      x: body.x,
      y: body.y,
      r: body.r,
      a: 1,
      person: ghost ? null : (people[i] ?? null),
    }));
  }

  function draw(): void {
    if (!ctx || !hasBox()) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, box.width, box.height);
    const items = drawItems().sort((p, q) => q.r - p.r);
    for (const item of items) {
      if (item.a <= 0 || item.r <= 0) continue;
      const { x, y, r, person } = item;
      if (!person) {
        ctx.globalAlpha = 0.45 * item.a;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = colors.border;
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.globalAlpha = item.a;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = person.image ? colors.panel : colors.borderStrong;
      ctx.fill();
      if (person.image) {
        ctx.save();
        ctx.clip();
        drawSource(ctx, person.image, x, y, r);
        ctx.restore();
      } else {
        ctx.fillStyle = colors.text;
        ctx.font = `600 ${Math.max(8, Math.round(r * 0.85))}px ${colors.fontHead}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(person.initial, x, y + r * 0.04);
      }
      if (person.self) {
        ctx.globalAlpha = item.a * 0.35;
        ctx.beginPath();
        ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = colors.accent;
        ctx.stroke();
        ctx.globalAlpha = item.a;
      }
      ctx.beginPath();
      ctx.arc(x, y, Math.max(0, r - 0.5), 0, Math.PI * 2);
      ctx.lineWidth = person.self ? 2.5 : 1;
      ctx.strokeStyle = person.self ? colors.accent : colors.borderStrong;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (morph) return;
    const rings = new Set([hovered, linked, drag?.moved ? drag.index : -1]);
    for (const i of rings) {
      const body = bodies[i];
      if (!body || ghost) continue;
      ctx.beginPath();
      ctx.arc(body.x, body.y, body.r + 2.5, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = colors.accent;
      ctx.stroke();
    }
    placeTip();
  }

  function scheduleDraw(): void {
    if (running || drawRaf || !canRun()) return;
    drawRaf = requestAnimationFrame(() => {
      drawRaf = 0;
      draw();
    });
  }

  function frame(time: number): void {
    raf = 0;
    if (!canRun()) {
      running = false;
      return;
    }
    if (morph) {
      if (morph.start === null) morph.start = time;
      morph.progress = Math.min(1, (time - morph.start) / BUBBLE_MORPH_MS);
      draw();
      if (morph.progress >= 1) {
        morph = null;
        running = false;
        draw();
        return;
      }
      raf = requestAnimationFrame(frame);
      return;
    }
    accumulator += Math.min(64, time - lastTime);
    lastTime = time;
    let steps = 0;
    while (accumulator >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
      lastFastest = stepBodies(bodies, box, { dragged: dragging() ? drag!.index : -1 });
      accumulator -= STEP_MS;
      steps += 1;
    }
    if (accumulator > STEP_MS * MAX_STEPS_PER_FRAME) accumulator = 0;
    draw();
    if (isSettled(bodies, lastFastest) && steps > 0) {
      running = false;
      if (!drag) settleAtRest();
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function settleAtRest(): void {
    const jammed = bodies.some((b) => Math.hypot(b.x - b.hx, b.y - b.hy) > JAM_DISTANCE);
    if (jammed) adoptRest(bodies);
  }

  function wake(): void {
    if (running || !canRun()) return;
    if (reduced() && !dragging()) {
      snapToHome(bodies);
      scheduleDraw();
      return;
    }
    running = true;
    lastTime = performance.now();
    accumulator = 0;
    lastFastest = Infinity;
    raf = requestAnimationFrame(frame);
  }

  function halt(): void {
    running = false;
    morph = null;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (drawRaf) cancelAnimationFrame(drawRaf);
    drawRaf = 0;
  }

  function startMorph(snap: Snapshot, next: Body[]): boolean {
    const to = next.map((body, i) => ({
      key: keys[i]!,
      pose: { x: body.x, y: body.y, r: body.r, a: 1 },
    }));
    const entries = planMorph(snap.items, snap.box, to, box);
    if (isStill(entries)) return false;
    const persons = entries.map((entry) =>
      entry.toIndex >= 0 ? (people[entry.toIndex] ?? null) : (snap.items[entry.fromIndex]?.person ?? null),
    );
    morph = { entries, persons, progress: 0, start: null };
    return true;
  }

  function layout(snap: Snapshot | null, repack: boolean): void {
    if (!hasBox()) return;
    const source = ghost ? GHOST_SCORES : scores;
    const sameKeys =
      snap !== null &&
      !ghost &&
      snap.items.length === keys.length &&
      snap.items.every((item, i) => item.key === keys[i]);
    if (snap && morph === null && sameKeys && !repack && !shouldRepack(snap.box, box)) {
      morph = null;
      rescaleBodies(bodies, snap.box, box);
      if (reduced()) snapToHome(bodies);
      draw();
      if (!reduced()) wake();
      return;
    }
    bodies = packCached(source);
    morph = null;
    if (snap && !ghost && !reduced() && canRun()) startMorph(snap, bodies);
    if (hovered >= bodies.length) hovered = -1;
    if (linked >= bodies.length) linked = -1;
    draw();
    if (morph) wake();
  }

  function sync(): boolean {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === box.width && height === box.height) return false;
    box = { width, height };
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    return true;
  }

  function measure(): void {
    if (destroyed) return;
    if (host.clientWidth === box.width && host.clientHeight === box.height) return;
    const snap = snapshot();
    sync();
    layout(snap, false);
  }

  function cancelDrag(): void {
    if (!drag) return;
    if (canvas.hasPointerCapture(drag.id)) canvas.releasePointerCapture(drag.id);
    drag = null;
    setCursor();
  }

  function setHover(index: number): void {
    if (index === hovered) return;
    hovered = index;
    if (index >= 0 && !(drag && drag.moved)) showTip(index);
    else tip.hidden = true;
    hooks.onHover(index >= 0 ? (people[index]?.handle ?? null) : null);
    scheduleDraw();
  }

  function local(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function setCursor(): void {
    if (drag?.moved) canvas.style.cursor = "grabbing";
    else canvas.style.cursor = hovered >= 0 ? "grab" : "";
  }

  function onPointerDown(event: PointerEvent): void {
    if (ghost || morph || (event.pointerType === "mouse" && event.button !== 0)) return;
    const { x, y } = local(event);
    const index = hitBody(bodies, x, y, event.pointerType === "mouse" ? 0 : 4);
    if (index < 0) return;
    const body = bodies[index]!;
    drag = {
      id: event.pointerId,
      index,
      startX: x,
      startY: y,
      offsetX: x - body.x,
      offsetY: y - body.y,
      moved: false,
      threshold: event.pointerType === "mouse" ? 4 : 8,
    };
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === "mouse") setHover(index);
  }

  function onPointerMove(event: PointerEvent): void {
    if (ghost || morph) return;
    const { x, y } = local(event);
    if (drag && drag.id === event.pointerId) {
      if (!drag.moved && Math.hypot(x - drag.startX, y - drag.startY) > drag.threshold) {
        drag.moved = true;
        tip.hidden = true;
        setCursor();
      }
      if (drag.moved) {
        const body = bodies[drag.index];
        if (!body) {
          cancelDrag();
          return;
        }
        body.x = clamp(x - drag.offsetX, body.r, box.width - body.r);
        body.y = clamp(y - drag.offsetY, body.r, box.height - body.r);
        body.vx = 0;
        body.vy = 0;
        wake();
      }
      return;
    }
    if (event.pointerType !== "mouse") return;
    setHover(hitBody(bodies, x, y));
    setCursor();
  }

  function endDrag(event: PointerEvent, click: boolean): void {
    if (!drag || drag.id !== event.pointerId) return;
    const finished = drag;
    drag = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (finished.moved) {
      if (reduced()) {
        halt();
        snapToHome(bodies);
        scheduleDraw();
      } else wake();
    } else if (click) {
      const handle = people[finished.index]?.handle;
      if (handle) window.open(`https://x.com/${handle}`, "_blank", "noopener,noreferrer");
    }
    if (event.pointerType === "mouse") {
      const { x, y } = local(event);
      const index = hitBody(bodies, x, y);
      if (index >= 0 && index === hovered) showTip(index);
      else setHover(index);
    } else setHover(-1);
    setCursor();
  }

  const onPointerUp = (event: PointerEvent) => endDrag(event, true);
  const onPointerCancel = (event: PointerEvent) => endDrag(event, false);
  const onPointerLeave = () => {
    if (drag) return;
    setHover(-1);
    setCursor();
  };

  function applyTheme(): void {
    colors = readColors(canvas);
    scheduleDraw();
  }

  function onVisibility(): void {
    docVisible = document.visibilityState !== "hidden";
    if (!docVisible) {
      halt();
      return;
    }
    wake();
    scheduleDraw();
  }

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  document.addEventListener("visibilitychange", onVisibility);
  schemeQuery?.addEventListener("change", applyTheme);

  const resizeObserver =
    typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  resizeObserver?.observe(host);

  const intersection =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver((entries) => {
          const entry = entries[entries.length - 1];
          if (!entry) return;
          onscreen = entry.isIntersecting;
          if (!onscreen) {
            halt();
            return;
          }
          wake();
          scheduleDraw();
        })
      : null;
  intersection?.observe(host);

  const themeObserver =
    typeof MutationObserver === "function" ? new MutationObserver(applyTheme) : null;
  themeObserver?.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "class"],
  });

  return {
    setData(payload, images) {
      if (destroyed) return;
      const snap = snapshot();
      const previousCount = bodies.length;
      const wasGhost = ghost;
      cancelDrag();
      if (hovered >= 0) hooks.onHover(null);
      hovered = -1;
      linked = -1;
      tip.hidden = true;
      if (!payload) {
        ghost = true;
        roster = [];
        rosterScores = [];
      } else {
        ghost = false;
        const built = buildPeople(payload, images);
        roster = built.people;
        rosterScores = built.scores;
      }
      derive();
      const changed = sync();
      if (!hasBox()) return;
      if (ghost && wasGhost && previousCount > 0 && !changed) return;
      layout(snap, !ghost);
    },
    setExpanded(next) {
      if (destroyed || next === expanded) return;
      const snap = snapshot();
      const linkedHandle = linked >= 0 ? (people[linked]?.handle ?? null) : null;
      cancelDrag();
      if (hovered >= 0) hooks.onHover(null);
      hovered = -1;
      tip.hidden = true;
      expanded = next;
      derive();
      linked = indexOfHandle(linkedHandle);
      if (ghost || roster.length === 0) return;
      sync();
      layout(snap, true);
    },
    positions() {
      return bodies.map((b) => ({ x: b.x, y: b.y, r: b.r }));
    },
    setHighlight(handle) {
      const index = indexOfHandle(handle);
      if (index === linked) return;
      linked = index;
      scheduleDraw();
    },
    destroy() {
      destroyed = true;
      halt();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      schemeQuery?.removeEventListener("change", applyTheme);
      resizeObserver?.disconnect();
      intersection?.disconnect();
      themeObserver?.disconnect();
      tip.remove();
    },
  };
}
