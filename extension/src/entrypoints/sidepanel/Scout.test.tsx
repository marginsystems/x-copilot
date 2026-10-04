import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scoutLook } from "../../../../shared/src/scoutCompanion";
import { SCOUT_DESK_PALETTE } from "../../../../shared/src/scoutCompanionStage";
import { SCOUT_VISIT, SCOUT_VISIT_TOTAL_MS } from "../../../../shared/src/scoutVisit";
import { panelSide } from "../../lib/scoutVisit";
import { Scout } from "./Scout";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const { listeners, addListener, removeListener, host, cheer, stageRef, measure } = vi.hoisted(() => {
  const listeners: ((raw: unknown) => unknown)[] = [];
  return {
    listeners,
    addListener: vi.fn((listener: (raw: unknown) => unknown) => { listeners.push(listener); }),
    removeListener: vi.fn((listener: (raw: unknown) => unknown) => {
      listeners.splice(listeners.indexOf(listener), 1);
    }),
    host: vi.fn(),
    cheer: vi.fn(),
    stageRef: { canHost: true },
    measure: vi.fn(),
  };
});

vi.mock("wxt/browser", () => ({
  browser: { runtime: { onMessage: { addListener, removeListener } } },
}));

vi.mock("../../lib/scoutVisit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/scoutVisit")>()),
  measureStageShift: measure,
}));

vi.mock("../../../../shared/src/scoutCompanionStage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../shared/src/scoutCompanionStage")>()),
  startScoutStage: () => ({
    show: vi.fn(),
    cheer,
    depart: vi.fn(),
    host: (...args: unknown[]) => {
      host(...args);
      return stageRef.canHost;
    },
    stop: vi.fn(),
  }),
}));

const awake = scoutLook({ connected: true, repliesToday: 0, stats: null });
const asleep = scoutLook({ connected: false, repliesToday: 0, stats: null });

describe("Scout visits", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    listeners.length = 0;
    stageRef.canHost = true;
    measure.mockReturnValue(0);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    vi.useRealTimers();
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("answers the desk's visit and hosts the desk palette from the edge facing the desk", async () => {
    act(() => root.render(<Scout look={awake} />));
    expect(listeners).toHaveLength(1);
    const reply = await listeners[0]?.({ type: SCOUT_VISIT });
    expect(reply).toEqual({ ok: true });
    expect(host).toHaveBeenCalledWith(SCOUT_DESK_PALETTE, panelSide() === "left" ? "right" : "left");
  });

  it("puts the line and the fact tiles above the stage so the ground line is the lowest thing in the section", () => {
    const withFacts = scoutLook({ connected: true, repliesToday: 4, stats: { level: 2, streak: 5 } });
    act(() => root.render(<Scout look={withFacts} />));
    const children = Array.from(container.querySelector("section")?.children ?? []).map((node) => node.tagName);
    expect(children).toEqual(["P", "DL", "CANVAS"]);
  });

  it("keeps the stage last in the section when Scout has no fact tiles", () => {
    act(() => root.render(<Scout look={asleep} />));
    const children = Array.from(container.querySelector("section")?.children ?? []).map((node) => node.tagName);
    expect(children.at(-1)).toBe("CANVAS");
  });

  it("eases the stage to the desk's ground line for the visit and back afterwards", async () => {
    vi.useFakeTimers();
    measure.mockReturnValue(12);
    act(() => root.render(<Scout look={awake} />));
    const canvas = container.querySelector("canvas");
    expect(canvas?.style.transform).toBe("");
    await act(async () => {
      await listeners[0]?.({ type: SCOUT_VISIT, groundFromBottomPx: 58 });
    });
    expect(measure).toHaveBeenCalledWith(canvas, 58, window.innerHeight);
    expect(canvas?.style.transform).toBe("translateY(12px)");
    act(() => vi.advanceTimersByTime(SCOUT_VISIT_TOTAL_MS - 1));
    expect(canvas?.style.transform).toBe("translateY(12px)");
    act(() => vi.advanceTimersByTime(1));
    expect(canvas?.style.transform).toBe("");
  });

  it("leaves the layout alone when no shift is needed or the stage refuses the visit", async () => {
    vi.useFakeTimers();
    act(() => root.render(<Scout look={awake} />));
    const canvas = container.querySelector("canvas");
    await act(async () => {
      await listeners[0]?.({ type: SCOUT_VISIT, groundFromBottomPx: 58 });
    });
    expect(canvas?.style.transform).toBe("");
    measure.mockReturnValue(12);
    stageRef.canHost = false;
    await act(async () => {
      await listeners[0]?.({ type: SCOUT_VISIT, groundFromBottomPx: 58 });
    });
    expect(canvas?.style.transform).toBe("");
    expect(measure).toHaveBeenCalledTimes(1);
  });

  it("does not answer other messages or a visit the stage refuses", () => {
    act(() => root.render(<Scout look={awake} />));
    expect(listeners[0]?.({ type: "x-copilot:reply-seen" })).toBeUndefined();
    expect(host).not.toHaveBeenCalled();
    stageRef.canHost = false;
    expect(listeners[0]?.({ type: SCOUT_VISIT })).toBeUndefined();
  });

  it("hops when the card it shows becomes detected, not when a detected card arrives", () => {
    act(() => root.render(<Scout look={awake} card={{ cardKey: "1", detected: false }} />));
    expect(cheer).not.toHaveBeenCalled();
    act(() => root.render(<Scout look={awake} card={{ cardKey: "1", detected: true }} />));
    expect(cheer).toHaveBeenCalledTimes(1);
    act(() => root.render(<Scout look={awake} card={{ cardKey: "2", detected: true }} />));
    act(() => root.render(<Scout look={awake} card={{ cardKey: "3", detected: false }} />));
    expect(cheer).toHaveBeenCalledTimes(1);
    act(() => root.render(<Scout look={awake} card={{ cardKey: "3", detected: true }} />));
    expect(cheer).toHaveBeenCalledTimes(2);
  });

  it("does not listen while Scout sleeps and stops listening on unmount", () => {
    act(() => root.render(<Scout look={asleep} />));
    expect(listeners).toHaveLength(0);
    act(() => root.render(<Scout look={awake} />));
    expect(listeners).toHaveLength(1);
    act(() => root.render(<Scout look={asleep} />));
    expect(listeners).toHaveLength(0);
    act(() => root.render(<Scout look={awake} />));
    act(() => root.unmount());
    expect(listeners).toHaveLength(0);
    root = createRoot(container);
  });
});
