import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isRecord } from "../../../shared/src/typeGuards";
import { SCOUT_GROUND_INSET } from "../../../shared/src/scoutCompanionStage";
import { parseScoutVisit, SCOUT_VISIT, SCOUT_VISIT_ACCEPTED } from "../../../shared/src/scoutVisit";

const { depart, cheer } = vi.hoisted(() => ({ depart: vi.fn(), cheer: vi.fn() }));

vi.mock("../../../shared/src/scoutCompanionStage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/src/scoutCompanionStage")>()),
  startScoutStage: () => ({ show: vi.fn(), cheer, depart, host: vi.fn(), stop: vi.fn() }),
}));

const visitPosts = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((call) => isRecord(call[0]) && call[0].type === SCOUT_VISIT);

let postSpy = vi.spyOn(window, "postMessage");

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  depart.mockClear();
  cheer.mockClear();
  postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mountCompanion() {
  const { ScoutCompanion } = await import("../../src/desk/ScoutCompanion");
  return render(<ScoutCompanion />);
}

function settle() {
  act(() => { vi.advanceTimersByTime(1_200); });
}

function accept(side: unknown, source: MessageEventSource | null = window, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: SCOUT_VISIT_ACCEPTED, side }, source, origin }));
  });
}

test("asks the extension for a visit once, after the page has had time to settle", async () => {
  const view = await mountCompanion();
  expect(visitPosts(postSpy)).toHaveLength(0);
  settle();
  const posts = visitPosts(postSpy);
  expect(posts).toHaveLength(1);
  expect(posts[0]?.[1]).toBe(window.location.origin);
  expect(parseScoutVisit(posts[0]?.[0])).toMatchObject({ type: SCOUT_VISIT });
  view.rerender(<></>);
  await mountCompanion();
  settle();
  expect(visitPosts(postSpy)).toHaveLength(1);
});

test("asks on the next mount when Scout left the page before it settled", async () => {
  const view = await mountCompanion();
  view.unmount();
  settle();
  expect(visitPosts(postSpy)).toHaveLength(0);
  await mountCompanion();
  settle();
  expect(visitPosts(postSpy)).toHaveLength(1);
});

test("asks on a remount before the previous settle timer fires", async () => {
  const view = await mountCompanion();
  act(() => { vi.advanceTimersByTime(600); });
  view.unmount();
  await mountCompanion();
  settle();
  expect(visitPosts(postSpy)).toHaveLength(1);
});

test("tells the extension how far its ground line sits above the bottom of the viewport", async () => {
  vi.stubGlobal("innerHeight", 800);
  vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ y: 600, height: 100 }));
  await mountCompanion();
  settle();
  expect(visitPosts(postSpy)[0]?.[0]).toEqual({ type: SCOUT_VISIT, groundFromBottomPx: 800 - (700 - SCOUT_GROUND_INSET) });
});

test("does not ask under reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  await mountCompanion();
  settle();
  expect(visitPosts(postSpy)).toHaveLength(0);
});

test("leaves toward the side the extension accepted", async () => {
  await mountCompanion();
  expect(depart).not.toHaveBeenCalled();
  accept("left");
  expect(depart).toHaveBeenCalledExactlyOnceWith("left");
});

test("ignores acceptances with a bad side, a foreign source or a foreign origin", async () => {
  await mountCompanion();
  accept("up");
  accept("right", null);
  accept("right", window, "https://evil.example");
  expect(depart).not.toHaveBeenCalled();
});

test("hops when the desk's card becomes detected, not when a detected card arrives", async () => {
  const { ScoutCompanion } = await import("../../src/desk/ScoutCompanion");
  const view = render(<ScoutCompanion card={{ cardKey: "scout:1", detected: false }} />);
  expect(cheer).not.toHaveBeenCalled();
  view.rerender(<ScoutCompanion card={{ cardKey: "scout:1", detected: true }} />);
  expect(cheer).toHaveBeenCalledTimes(1);
  view.rerender(<ScoutCompanion card={{ cardKey: "for_you:", detected: true }} />);
  expect(cheer).toHaveBeenCalledTimes(1);
});
