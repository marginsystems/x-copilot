import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isRecord } from "../../../shared/src/typeGuards";
import { SCOUT_VISIT, SCOUT_VISIT_ACCEPTED } from "../../../shared/src/scoutVisit";

const { depart, cheer } = vi.hoisted(() => ({ depart: vi.fn(), cheer: vi.fn() }));

vi.mock("../../../shared/src/scoutCompanionStage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/src/scoutCompanionStage")>()),
  startScoutStage: () => ({ show: vi.fn(), cheer, depart, host: vi.fn(), stop: vi.fn() }),
}));

const visitPosts = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter((call) => isRecord(call[0]) && call[0].type === SCOUT_VISIT);

let postSpy = vi.spyOn(window, "postMessage");

beforeEach(() => {
  vi.resetModules();
  depart.mockClear();
  cheer.mockClear();
  postSpy = vi.spyOn(window, "postMessage").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function mountCompanion() {
  const { ScoutCompanion } = await import("../../src/desk/ScoutCompanion");
  return render(<ScoutCompanion />);
}

function accept(side: unknown, source: MessageEventSource | null = window, origin = window.location.origin) {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data: { type: SCOUT_VISIT_ACCEPTED, side }, source, origin }));
  });
}

test("asks the extension for a visit once when the stage mounts", async () => {
  const view = await mountCompanion();
  expect(visitPosts(postSpy)).toEqual([[{ type: SCOUT_VISIT }, window.location.origin]]);
  view.rerender(<></>);
  await mountCompanion();
  expect(visitPosts(postSpy)).toHaveLength(1);
});

test("does not ask under reduced motion", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  await mountCompanion();
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
