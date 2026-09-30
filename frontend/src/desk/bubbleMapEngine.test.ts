import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { packBubbles, stepBodies } from "../lib/bubbleLayout.ts";
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
  const arcs: Array<[number, number, number]> = [];
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
    arcs,
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
    releasePointerCapture() {},
    hasPointerCapture: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    getContext: () =>
      new Proxy(
        { arc: (x: number, y: number, r: number) => arcs.push([x, y, r]) },
        {
          get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
          set: () => true,
        },
      ),
  };
  return element;
}

const saved: Record<string, unknown> = {};
let opened: unknown[][] = [];
let frames = new Map<number, (time: number) => void>();
let nextFrame = 1;

beforeEach(() => {
  opened = [];
  const g = globalThis as Record<string, unknown>;
  for (const key of [
    "document",
    "window",
    "getComputedStyle",
    "matchMedia",
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ]) {
    saved[key] = g[key];
  }
  frames = new Map();
  nextFrame = 1;
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
  g.matchMedia = () => ({ matches: false, addEventListener() {} });
  g.requestAnimationFrame = (callback: (time: number) => void) => {
    const id = nextFrame++;
    frames.set(id, callback);
    return id;
  };
  g.cancelAnimationFrame = (id: number) => frames.delete(id);
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
});

function setup(count: number, reducedMotion = false) {
  (globalThis as Record<string, unknown>).matchMedia = () => ({
    matches: reducedMotion,
    addEventListener() {},
  });
  const canvas = fakeElement();
  const host = fakeElement();
  const hovers: Array<string | null> = [];
  const engine = createBubbleMap(canvas as unknown as HTMLCanvasElement, host as unknown as HTMLElement, {
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

function runFrame(time: number): void {
  const next = frames.entries().next().value as [number, (time: number) => void] | undefined;
  if (!next) throw new Error("No animation frame was scheduled");
  frames.delete(next[0]);
  next[1](time);
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

  it("coalesces reduced-motion drag physics into an animation frame", () => {
    const { bodies, fire, canvas } = setup(12, true);
    const data = payload(12);
    const expected = packBubbles(data.members.map((m) => Math.max(1, memberScore(m))), BOX);
    const target = bodies[5]!;
    fire("pointerdown", target.x, target.y);
    fire("pointermove", target.x + 30, target.y + 30);
    fire("pointermove", target.x + 40, target.y + 40);
    fire("pointermove", target.x + 50, target.y + 50);
    expected[5]!.x = Math.min(target.x + 50, BOX.width - target.r);
    expected[5]!.y = Math.min(target.y + 50, BOX.height - target.r);
    stepBodies(expected, BOX, { dragged: 5 });
    const initialFrameTime = performance.now();
    runFrame(initialFrameTime + 17);
    runFrame(initialFrameTime + 17);
    const visible = canvas.arcs
      .slice(-expected.length * 2 - 1, -1)
      .filter((_, index) => index % 2 === 0);
    const order = expected.map((_, i) => i).sort((a, b) => expected[b]!.r - expected[a]!.r);
    assert.deepEqual(visible, order.map((i) => [expected[i]!.x, expected[i]!.y, expected[i]!.r]));
  }).catch(assert.fail);

  it("survives new data mid-drag with fewer bodies", () => {
    const { engine, bodies, fire, hovers } = setup(40);
    const target = bodies[30]!;
    fire("pointerdown", target.x, target.y);
    fire("pointermove", target.x + 20, target.y + 20);
    engine.setData(null, null);
    assert.doesNotThrow(() => {
      fire("pointermove", target.x + 40, target.y + 40);
      fire("pointermove", target.x + 60, target.y + 60);
      fire("pointerup", target.x + 60, target.y + 60);
    });
    assert.deepEqual(opened, []);
    assert.equal(hovers.at(-1), null);
  }).catch(assert.fail);
});
