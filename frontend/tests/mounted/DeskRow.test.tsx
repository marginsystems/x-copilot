import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DeskRow } from "../../src/desk/DeskRow";
import { ForYouFeedRow } from "../../src/desk/ForYouFeedRow";
import { ThreadRow } from "../../src/desk/ThreadRow";

type Played = {
  target: HTMLElement;
  keyframes: Keyframe[];
  animation: { onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn> };
};

const played: Played[] = [];
const lefts: Record<string, number> = {};
let rowHeight = 80;

beforeEach(() => {
  played.length = 0;
  rowHeight = 80;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value: function (this: HTMLElement, keyframes: Keyframe[]) {
      const animation = { onfinish: null, cancel: vi.fn() };
      played.push({ target: this, keyframes, animation });
      return animation;
    },
  });
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: function (this: HTMLElement) {
      return played
        .filter((entry) => entry.target === this)
        .map((entry) => entry.animation);
    },
  });
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return lefts[this.dataset.action ?? ""] ?? 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      const draining = played.find(
        (entry) =>
          entry.target === this &&
          entry.keyframes.some(
            (frame) => "height" in frame && frame.height === "0px",
          ) &&
          entry.animation.cancel.mock.calls.length === 0,
      );
      return draining ? 0 : rowHeight;
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (Element.prototype as { animate?: unknown }).animate;
  delete (Element.prototype as { getAnimations?: unknown }).getAnimations;
  for (const key of Object.keys(lefts)) delete lefts[key];
});

test("a card that never had actions renders no action row", () => {
  const { container } = render(<DeskRow lead="Skipped" summary="No actions" />);

  expect(container.querySelector(".thread-row > .row")).toBeNull();
});

test("a For You row that turns expandable on detection stays open in the same frame", () => {
  const { container, rerender } = render(
    <DeskRow lead="FY" summary="Detection in progress." open>
      <p>Reply to something you read.</p>
    </DeskRow>,
  );

  rerender(
    <DeskRow lead="FY" summary="Post detected" open expandable onToggle={vi.fn()}>
      <p>Posted.</p>
    </DeskRow>,
  );

  // No enter replay: `open` never drops, so the detail cannot start collapsing.
  expect(container.querySelector("article")?.classList.contains("open")).toBe(true);
  expect(container.querySelector(".caret")?.textContent).toBe("–");
  expect(
    container.querySelector(".row-detail-slot")?.getAttribute("aria-hidden"),
  ).toBe("false");
});

test("detection lifts the open buttons out of flow at their old spot and glides Next from there", () => {
  lefts.open = 250;
  lefts.next = 290;
  const { container, rerender } = render(
    <ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} />,
  );

  lefts.open = 0;
  lefts.next = 0;
  rerender(<ForYouFeedRow detected activity={null} onNext={vi.fn()} />);

  const ghost = container.querySelector<HTMLElement>(".row-action.is-leaving");
  expect(ghost?.dataset.action).toBe("open");
  expect(ghost?.style.left).toBe("250px");
  expect(ghost?.getAttribute("aria-hidden")).toBe("true");
  expect(ghost?.hasAttribute("inert")).toBe(true);
  expect(ghost?.textContent).toBe("Open For You");
  const secondary = container.querySelector<HTMLElement>('.row-action.is-leaving[data-action="open-secondary"]');
  expect(secondary?.textContent).toBe("Open Inspiration");
  expect(container.querySelector(".for-you-detected-summary")).not.toBeNull();

  const inFlow = [...container.querySelectorAll<HTMLElement>(".row-action:not(.is-leaving)")];
  expect(inFlow.map((unit) => unit.dataset.action)).toEqual(["next"]);

  const glide = played.find((entry) => entry.target.dataset.action === "next");
  expect(glide?.keyframes[0]).toEqual({ transform: "translate(290px, 0px)" });
  expect(glide?.keyframes.at(-1)).toEqual({ transform: "translate(0, 0)" });
  expect(played.some((entry) => /width|margin|grid/.test(JSON.stringify(entry.keyframes)))).toBe(false);

  act(() => {
    for (const entry of played) {
      if (entry.target.classList.contains("is-leaving")) entry.animation.onfinish?.();
    }
  });
  expect(container.querySelector(".row-action.is-leaving")).toBeNull();
});

test("a revived action is measured again before it departs a second time", () => {
  lefts.open = 40;
  const { container, rerender } = render(
    <ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} />,
  );

  rerender(<ForYouFeedRow detected activity={null} onNext={vi.fn()} />);
  expect(container.querySelector<HTMLElement>(".row-action.is-leaving")?.style.left).toBe(
    "40px",
  );

  lefts.open = 120;
  rerender(<ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} />);
  rerender(<ForYouFeedRow detected activity={null} onNext={vi.fn()} />);

  expect(container.querySelector<HTMLElement>(".row-action.is-leaving")?.style.left).toBe(
    "120px",
  );
});

test("a Scout card keeps Open on X and Next still while Skip and Not interested fade", () => {
  lefts.open = 0;
  lefts.next = 120;
  lefts.skip = 200;
  const props = { lead: "7", summary: "Thread", openHref: "https://x.com/a/status/1", openLabel: "Open on X", onNext: vi.fn() };
  rowHeight = 88;
  const { container, rerender } = render(
    <DeskRow {...props} onSkip={vi.fn()} onDismiss={vi.fn()} />,
  );

  rowHeight = 64;
  rerender(<DeskRow {...props} />);

  expect(container.querySelector<HTMLElement>(".row-action.is-leaving")?.dataset.action).toBe("skip");
  expect(played.some((entry) => /transform/.test(JSON.stringify(entry.keyframes)))).toBe(false);
  const row = container.querySelector(".thread-row > .row");
  const heightChange = played.find((entry) => entry.target === row);
  expect(heightChange?.keyframes).toEqual([{ height: "88px" }, { height: "64px" }]);
});

test("a row that loses every action eases its height shut before it unmounts", () => {
  rowHeight = 96;
  const { container, rerender } = render(
    <ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} />,
  );

  rowHeight = 0;
  rerender(<ForYouFeedRow detected activity={null} />);

  const row = container.querySelector<HTMLElement>(".thread-row > .row");
  expect(row?.classList.contains("is-draining")).toBe(true);
  const drain = played.find((entry) => entry.target === row);
  expect(drain?.keyframes[0]).toEqual({ height: "96px" });
  expect(drain?.keyframes.at(-1)).toEqual({ height: "0px", paddingBottom: "0px" });

  act(() => {
    for (const entry of played) entry.animation.onfinish?.();
  });
  expect(container.querySelector(".thread-row > .row")).toBeNull();
});

test("a row revived during its drain cancels the collapse and measures its restored height", () => {
  rowHeight = 96;
  const { container, rerender } = render(
    <DeskRow lead="Approach" onNext={vi.fn()} />,
  );
  const row = container.querySelector<HTMLElement>(".thread-row > .row");
  expect(row).not.toBeNull();

  rerender(<DeskRow lead="Approach" />);
  const drain = played.find(
    (entry) => entry.target === row && entry.keyframes.at(-1)?.height === "0px",
  );
  expect(drain).toBeDefined();

  rowHeight = 64;
  rerender(<DeskRow lead="Approach" onNext={vi.fn()} />);

  expect(drain?.animation.cancel).toHaveBeenCalled();
  expect(row?.classList.contains("is-draining")).toBe(false);
  expect(row?.querySelector("[data-action='next']")).not.toBeNull();
  expect(row?.offsetHeight).toBe(64);

  rowHeight = 72;
  rerender(<DeskRow lead="Approach" onNext={vi.fn()} />);
  const rowAnimations = played.filter((entry) => entry.target === row);
  expect(rowAnimations.at(-1)?.keyframes).toEqual([
    { height: "64px" },
    { height: "72px" },
  ]);
});

test("reduced motion drops departing actions at once", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const { container, rerender } = render(
    <ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} />,
  );

  rerender(<ForYouFeedRow detected activity={null} onNext={vi.fn()} />);

  expect(container.querySelector(".row-action.is-leaving")).toBeNull();
  expect(played).toHaveLength(0);
});

const scoutThread = {
  id: "S",
  author: "@S",
  text: "incoming Scout",
  url: "https://x.com/S/status/S",
};

function scoutRow(openPace: { remainingMs: number; clock: string } | null) {
  return (
    <ThreadRow
      thread={scoutThread}
      open={false}
      busy={false}
      interacted={false}
      onToggle={vi.fn()}
      onSkip={vi.fn()}
      onDismiss={vi.fn()}
      onNext={vi.fn()}
      openPace={openPace}
    />
  );
}

test("a paced Scout card gates Open on X in place and keeps the card usable", () => {
  const { container, rerender } = render(scoutRow({ remainingMs: 34_000, clock: "0:34" }));

  const gated = container.querySelector<HTMLButtonElement>('[data-action="open"] button.row-open');
  expect(gated?.classList.contains("is-paced")).toBe(true);
  expect(gated?.getAttribute("aria-disabled")).toBe("true");
  expect(gated?.disabled).toBe(false);
  expect(gated?.dataset.tip).toContain("0:34 left");
  expect(gated?.querySelector(".row-open-label")?.textContent).toBe("Open on X");
  expect(gated?.querySelector(".row-open-ring")).not.toBeNull();
  expect(gated?.getAttribute("aria-label")).toContain("0:34 left");
  const click = new MouseEvent("click", { bubbles: true, cancelable: true });
  gated?.dispatchEvent(click);
  expect(click.defaultPrevented).toBe(true);
  expect(container.textContent).toContain("Skip");
  expect(container.textContent).toContain("Not interested");
  expect(container.textContent).toContain("Next");

  rerender(scoutRow(null));

  const ready = container.querySelector<HTMLAnchorElement>('[data-action="open"] a.row-open');
  expect(ready?.getAttribute("href")).toBe(scoutThread.url);
  expect(ready?.querySelector(".row-open-label")?.textContent).toBe("Open on X");
  expect(ready?.querySelector(".row-open-arrow")).not.toBeNull();
  expect(container.querySelector(".row-action.is-leaving")).toBeNull();
  expect(played).toHaveLength(0);
});

test("the pace ring drains with the remaining minute", () => {
  const { container, rerender } = render(scoutRow({ remainingMs: 60_000, clock: "1:00" }));
  const offset = () =>
    Number(container.querySelector(".row-open-ring-fill")?.getAttribute("stroke-dashoffset"));
  const full = offset();

  rerender(scoutRow({ remainingMs: 30_000, clock: "0:30" }));
  const half = offset();
  rerender(scoutRow({ remainingMs: 1_000, clock: "0:01" }));

  expect(full).toBe(0);
  expect(half).toBeGreaterThan(full);
  expect(offset()).toBeGreaterThan(half);
});

test("a paced For You card collapses to one gated button and splits back when the minute ends", () => {
  lefts.next = 150;
  const { container, rerender } = render(
    <ForYouFeedRow
      status="Detecting"
      detected={false}
      onNext={vi.fn()}
      openPace={{ remainingMs: 20_000, clock: "0:20" }}
    />,
  );

  const units = () =>
    [...container.querySelectorAll<HTMLElement>(".row-action:not(.is-leaving)")].map(
      (unit) => unit.dataset.action,
    );
  expect(units()).toEqual(["open", "next"]);
  expect(container.querySelector('[data-action="open"] button.is-paced')?.textContent).toBe(
    "Open For You",
  );
  expect(container.textContent).not.toContain("Open Inspiration");

  lefts.next = 330;
  rerender(
    <ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} openPace={null} />,
  );

  expect(units()).toEqual(["open", "open-secondary", "next"]);
  expect(container.querySelector('[data-action="open"] a.row-open')?.textContent).toBe(
    "Open For You",
  );
  const arrive = played.find((entry) => entry.target.dataset.action === "open-secondary");
  expect(arrive?.keyframes).toEqual([{ opacity: 0 }, { opacity: 1 }]);
  const glide = played.find((entry) => entry.target.dataset.action === "next");
  expect(glide?.keyframes[0]).toEqual({ transform: "translate(-180px, 0px)" });
  expect(container.querySelector(".row-action.is-leaving")).toBeNull();
});
