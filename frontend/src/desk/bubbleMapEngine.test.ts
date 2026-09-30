import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { packBubbles } from "../lib/bubbleLayout.ts";
import { memberScore } from "../lib/circleLeaderboard.ts";
import type { CircleSharePayload } from "../lib/circleShare.ts";
import { createBubbleMap } from "./bubbleMapEngine.ts";

type Listener = (event: Record<string, unknown>) => void;

const BOX = { width: 222, height: 278 };

function payload(count: number): CircleSharePayload {
  return {
    handle: "me",
    name: "Me",
    avatarUrl: null,
    generatedAt: "",
    members: Array.from({ length: count }, (_, i) => ({
      handle: `friend_${i}`,
      name: `Friend ${i}`,
      avatarUrl: null,
      replies: 40 - i,
      quotes: 0,
      score: 40 - i,
      lastAt: "",
    })),
    totals: { replies: 100, quotes: 0, people: count },
  };
}

function fakeElement() {
  const listeners = new Map<string, Listener>();
  const element = {
    className: "",
    hidden: false,
    style: {} as Record<string, string>,
    offsetWidth: 60,
    offsetHeight: 30,
    clientWidth: BOX.width,
    clientHeight: BOX.height,
    width: 0,
    height: 0,
    textContent: "",
    listeners,
    setAttribute() {},
    appendChild() {},
    replaceChildren() {},
    remove() {},
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, fn);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    setPointerCapture() {},
    released: [] as number[],
    releasePointerCapture(id: number) {
      element.released.push(id);
    },
    hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getContext: () => new Proxy({}, { get: () => () => undefined, set: () => true }),
  };
  return element;
}

function isCanvas(value: unknown): value is HTMLCanvasElement {
  return typeof value === "object";
}

function isHost(value: unknown): value is HTMLElement {
  return typeof value === "object";
}

function asCanvas(value: unknown): HTMLCanvasElement {
  if (!isCanvas(value)) throw new Error("not a canvas");
  return value;
}

function asHost(value: unknown): HTMLElement {
  if (!isHost(value)) throw new Error("not a host");
  return value;
}

const saved: Record<string, unknown> = {};
let opened: unknown[][] = [];
let frames: Array<(time: number) => void> = [];
let clock = 0;

function pump(count: number): void {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    clock += 17;
    for (const cb of due) cb(clock);
  }
}

beforeEach(() => {
  opened = [];
  frames = [];
  clock = performance.now();
  const g = globalThis as Record<string, unknown>;
  for (const key of ["document", "window", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
    saved[key] = g[key];
  }
  g.document = {
    createElement: () => fakeElement(),
    addEventListener() {},
    removeEventListener() {},
    visibilityState: "visible",
    documentElement: {},
  };
  g.window = {
    devicePixelRatio: 1,
    open: (...args: unknown[]) => {
      opened.push(args);
      return null;
    },
  };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  g.requestAnimationFrame = (cb: (time: number) => void) => frames.push(cb);
  g.cancelAnimationFrame = () => undefined;
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
});

function setup(count: number) {
  const canvas = fakeElement();
  const host = fakeElement();
  const hovers: Array<string | null> = [];
  const engine = createBubbleMap(asCanvas(canvas), asHost(host), {
    onHover: (handle) => hovers.push(handle),
  });
  const data = payload(count);
  engine.setData(data, new Map());
  const scores = data.members.map((m) => Math.max(1, memberScore(m)));
  const bodies = packBubbles(scores, BOX);
  const fire = (type: string, x: number, y: number) =>
    canvas.listeners.get(type)?.({ pointerId: 1, pointerType: "mouse", button: 0, clientX: x, clientY: y });
  return { engine, bodies, fire, hovers, canvas };
}

await describe("bubbleMapEngine", () => {
  it("opens the profile on a click without movement", () => {
    const { bodies, fire } = setup(12);
    const target = bodies[1]!;
    fire("pointerdown", target.x, target.y);
    fire("pointerup", target.x, target.y);
    assert.deepEqual(opened, [["https://x.com/friend_0", "_blank", "noopener,noreferrer"]]);
  }).catch(assert.fail);

  it("does not open the profile after dragging past the threshold", () => {
    const { bodies, fire } = setup(12);
    const target = bodies[1]!;
    fire("pointerdown", target.x, target.y);
    fire("pointermove", target.x + 30, target.y + 30);
    fire("pointerup", target.x + 30, target.y + 30);
    assert.deepEqual(opened, []);
  }).catch(assert.fail);

  it("cancels a live drag when a smaller payload re-packs to fewer bodies", () => {
    const { engine, bodies, fire, hovers, canvas } = setup(40);
    const target = bodies[30]!;
    fire("pointerdown", target.x, target.y);
    fire("pointermove", target.x + 20, target.y + 20);
    assert.equal(hovers.at(-1), "friend_29");
    engine.setData(payload(8), new Map());
    assert.deepEqual(canvas.released, [1]);
    assert.equal(hovers.at(-1), null);
    assert.equal(engine.positions().length, 9);
    assert.doesNotThrow(() => {
      fire("pointermove", target.x + 40, target.y + 40);
      fire("pointermove", target.x + 60, target.y + 60);
      fire("pointerup", target.x + 60, target.y + 60);
      pump(5);
    });
    assert.deepEqual(opened, []);
  }).catch(assert.fail);

  it("schedules frames while dragging and pushes a neighbour away", () => {
    const { engine, bodies, fire } = setup(12);
    const grabbed = bodies[1]!;
    const other = bodies[2]!;
    const before = engine.positions();
    frames = [];
    fire("pointerdown", grabbed.x, grabbed.y);
    fire("pointermove", grabbed.x + (other.x - grabbed.x) * 0.8, grabbed.y + (other.y - grabbed.y) * 0.8);
    assert.ok(frames.length > 0);
    pump(12);
    const after = engine.positions();
    assert.ok(Math.hypot(after[2]!.x - before[2]!.x, after[2]!.y - before[2]!.y) > 0.5);
    assert.notDeepEqual(after[1], before[1]);
  }).catch(assert.fail);
});
