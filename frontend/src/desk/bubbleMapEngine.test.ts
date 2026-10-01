import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { memberLimit, packBubbles } from "../lib/bubbleLayout.ts";
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
let created: Array<ReturnType<typeof fakeElement>> = [];
let resizeCallbacks: Array<() => void> = [];
let frames: Array<(time: number) => void> = [];
let clock = 0;

function pump(count: number): void {
  for (let i = 0; i < count; i++) {
    const due = frames;
    frames = [];
    clock = Math.max(clock, performance.now()) + 17;
    for (const cb of due) cb(clock);
  }
}

beforeEach(() => {
  opened = [];
  created = [];
  resizeCallbacks = [];
  frames = [];
  clock = performance.now();
  const g = globalThis as Record<string, unknown>;
  for (const key of [
    "document",
    "window",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "ResizeObserver",
    "matchMedia",
  ]) {
    saved[key] = g[key];
  }
  g.document = {
    createElement: () => {
      const element = fakeElement();
      created.push(element);
      return element;
    },
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
  g.ResizeObserver = class {
    constructor(callback: () => void) {
      resizeCallbacks.push(callback);
    }
    observe() {}
    disconnect() {}
  };
});

afterEach(() => {
  const g = globalThis as Record<string, unknown>;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete g[key];
    else g[key] = value;
  }
});

function setup(count: number, expanded = false) {
  const canvas = fakeElement();
  const host = fakeElement();
  const hovers: Array<string | null> = [];
  const engine = createBubbleMap(asCanvas(canvas), asHost(host), {
    onHover: (handle) => hovers.push(handle),
  });
  const data = payload(count);
  engine.setExpanded(expanded);
  engine.setData(data, new Map());
  const scores = data.members.map((m) => Math.max(1, memberScore(m)));
  const bodies = packBubbles(scores.slice(0, memberLimit(expanded)), BOX);
  const fire = (type: string, x: number, y: number, pointerType = "mouse") =>
    canvas.listeners.get(type)?.({ pointerId: 1, pointerType, button: 0, clientX: x, clientY: y });
  return { engine, bodies, fire, hovers, canvas, host };
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

  it("shows the tooltip again when a drag is released over the same bubble", () => {
    const { bodies, fire } = setup(12);
    const tip = created.find((element) => element.className === "desk-circle-tip")!;
    const target = bodies[1]!;
    fire("pointermove", target.x, target.y);
    assert.equal(tip.hidden, false);
    fire("pointerdown", target.x, target.y);
    fire("pointermove", target.x + 10, target.y);
    assert.equal(tip.hidden, true);
    fire("pointerup", target.x + 10, target.y);
    assert.equal(tip.hidden, false);
  }).catch(assert.fail);

  it("opens the profile on a touch tap and on a touch wobble under the touch threshold", () => {
    const { bodies, fire, hovers } = setup(12);
    const target = bodies[1]!;
    fire("pointerdown", target.x, target.y, "touch");
    fire("pointerup", target.x, target.y, "touch");
    fire("pointerdown", target.x, target.y, "touch");
    fire("pointermove", target.x + 6, target.y, "touch");
    fire("pointerup", target.x + 6, target.y, "touch");
    assert.equal(opened.length, 2);
    assert.ok(hovers.every((handle) => handle === null));
  }).catch(assert.fail);

  it("treats a touch move past the touch threshold as a drag", () => {
    const { bodies, fire } = setup(12);
    const target = bodies[1]!;
    fire("pointerdown", target.x, target.y, "touch");
    fire("pointermove", target.x + 9, target.y, "touch");
    fire("pointerup", target.x + 9, target.y, "touch");
    assert.deepEqual(opened, []);
  }).catch(assert.fail);

  it("re-fits the same members into a resized box without changing the count", () => {
    const { engine, host } = setup(12);
    const before = engine.positions().length;
    host.clientWidth = 148;
    for (const callback of resizeCallbacks) callback();
    pump(30);
    const after = engine.positions();
    assert.equal(after.length, before);
    for (const body of after) {
      assert.ok(body.x - body.r >= -0.5 && body.x + body.r <= 148.5, `x ${body.x} r ${body.r}`);
      assert.ok(body.y - body.r >= -0.5 && body.y + body.r <= BOX.height + 0.5, `y ${body.y} r ${body.r}`);
    }
  }).catch(assert.fail);

  it("fills the tooltip with the name, the @handle and the counts", () => {
    const { bodies, fire } = setup(12);
    const target = bodies[1]!;
    fire("pointermove", target.x, target.y);
    const lines = created
      .filter((element) => element.className.startsWith("desk-circle-tip-"))
      .map((element) => [element.className, element.textContent]);
    assert.deepEqual(lines.slice(0, 2), [
      ["desk-circle-tip-name", "Friend 0"],
      ["desk-circle-tip-handle", "@friend_0"],
    ]);
    assert.equal(lines[2]?.[0], "desk-circle-tip-detail");
    assert.match(lines[2]?.[1] ?? "", /^40 replies$/);
  }).catch(assert.fail);

  it("snaps back to rest on release under reduced motion", () => {
    (globalThis as Record<string, unknown>).matchMedia = (query: string) => ({
      matches: query.includes("reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    });
    const { engine, bodies, fire } = setup(12);
    const rest = engine.positions();
    const target = bodies[1]!;
    fire("pointerdown", target.x, target.y);
    fire("pointermove", target.x + 40, target.y + 10);
    pump(5);
    assert.notDeepEqual(engine.positions(), rest);
    fire("pointerup", target.x + 40, target.y + 10);
    pump(5);
    const after = engine.positions();
    assert.equal(after.length, rest.length);
    after.forEach((body, i) => {
      assert.ok(Math.hypot(body.x - rest[i]!.x, body.y - rest[i]!.y) < 0.5, `body ${i} not at rest`);
    });
  }).catch(assert.fail);

  it("cancels a live drag when a smaller payload re-packs to fewer bodies", () => {
    const { engine, bodies, fire, hovers, canvas } = setup(40, true);
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

  it("draws only the compact member count and the top forty when expanded", () => {
    const { engine } = setup(40);
    assert.equal(engine.positions().length, memberLimit(false) + 1);
    engine.setExpanded(true);
    assert.equal(engine.positions().length, memberLimit(true) + 1);
    engine.setExpanded(false);
    assert.equal(engine.positions().length, memberLimit(false) + 1);
  }).catch(assert.fail);

  it("redraws synchronously when the box changes so no stale bitmap is painted", () => {
    const { engine, host, canvas } = setup(40);
    frames = [];
    host.clientWidth = 525;
    host.clientHeight = 232;
    engine.setExpanded(true);
    assert.equal(canvas.width, 525);
    assert.equal(canvas.height, 232);
    const first = engine.positions();
    for (const body of first) {
      assert.ok(body.x - body.r >= -0.5 && body.x + body.r <= 525.5);
      assert.ok(body.y - body.r >= -0.5 && body.y + body.r <= 232.5);
    }
  }).catch(assert.fail);

  it("runs the morph for about 300ms and then stops scheduling frames", () => {
    const { engine, host } = setup(40);
    host.clientWidth = 525;
    host.clientHeight = 232;
    engine.setExpanded(true);
    assert.ok(frames.length > 0);
    let elapsed = 0;
    let guard = 0;
    while (frames.length > 0 && guard < 100) {
      const due = frames;
      frames = [];
      elapsed += 17;
      for (const cb of due) cb(1000 + elapsed);
      guard += 1;
    }
    assert.ok(elapsed >= 250 && elapsed <= 400, `elapsed ${elapsed}`);
    assert.equal(frames.length, 0);
  }).catch(assert.fail);

  it("swaps instantly with no morph frames under reduced motion", () => {
    (globalThis as Record<string, unknown>).matchMedia = (query: string) => ({
      matches: query.includes("reduced-motion"),
      addEventListener() {},
      removeEventListener() {},
    });
    const { engine, host } = setup(40);
    frames = [];
    host.clientWidth = 525;
    host.clientHeight = 232;
    engine.setExpanded(true);
    assert.equal(frames.length, 0);
    assert.equal(engine.positions().length, memberLimit(true) + 1);
  }).catch(assert.fail);
});
