import { act, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MissionSlide } from "../../src/desk/MissionSlide";
import { MISSION_SLIDE_MS } from "../../src/lib/missionSlide";

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({ matches, media: query })),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function cards(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(".mission-slide-card"));
}

test("the outgoing card stays inert beside the incoming card until the slide ends", () => {
  vi.useFakeTimers();
  stubReducedMotion(false);
  const { container, rerender } = render(
    <MissionSlide slideKey="a"><p>first</p></MissionSlide>,
  );
  const first = cards(container)[0];

  rerender(<MissionSlide slideKey="b"><p>second</p></MissionSlide>);
  const [leaving, entering] = cards(container);
  expect(leaving).toBe(first);
  expect(leaving.className).toContain("is-leaving");
  expect(leaving.getAttribute("aria-hidden")).toBe("true");
  expect(leaving.hasAttribute("inert")).toBe(true);
  expect(leaving.textContent).toBe("first");
  expect(entering.className).not.toContain("is-leaving");
  expect(entering.textContent).toBe("second");

  act(() => {
    vi.advanceTimersByTime(MISSION_SLIDE_MS);
  });
  expect(cards(container).map((el) => el.textContent)).toEqual(["second"]);
});

test("a reused leaving card is interactive when it becomes current again", () => {
  vi.useFakeTimers();
  stubReducedMotion(false);
  const { container, rerender } = render(
    <MissionSlide slideKey="a"><p>first</p></MissionSlide>,
  );
  const first = cards(container)[0];

  rerender(<MissionSlide slideKey="b"><p>second</p></MissionSlide>);
  rerender(<MissionSlide slideKey="a"><p>first again</p></MissionSlide>);

  const current = cards(container).find((el) => el.textContent === "first again");
  expect(current).toBe(first);
  expect(current?.className).not.toContain("is-leaving");
  expect(current?.hasAttribute("inert")).toBe(false);
  expect(current?.hasAttribute("aria-hidden")).toBe(false);
});

test("updates to the same card do not slide", () => {
  stubReducedMotion(false);
  const { container, rerender } = render(
    <MissionSlide slideKey="a"><p>first</p></MissionSlide>,
  );
  const first = cards(container)[0];

  rerender(<MissionSlide slideKey="a"><p>first, detected</p></MissionSlide>);
  expect(cards(container)).toEqual([first]);
  expect(first.textContent).toBe("first, detected");
});

test("reduced motion swaps the card without a leaving copy", () => {
  stubReducedMotion(true);
  const { container, rerender } = render(
    <MissionSlide slideKey="a"><p>first</p></MissionSlide>,
  );

  rerender(<MissionSlide slideKey="b"><p>second</p></MissionSlide>);
  expect(cards(container).map((el) => el.textContent)).toEqual(["second"]);
});
