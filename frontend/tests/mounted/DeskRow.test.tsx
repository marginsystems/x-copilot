import { render } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { DeskRow } from "../../src/desk/DeskRow";
import { ForYouFeedRow } from "../../src/desk/ForYouFeedRow";

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

test("a detected For You row retains departing actions beside its arriving chip", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
  const { container, rerender } = render(
    <ForYouFeedRow status="Detecting" detected={false} onNext={vi.fn()} />,
  );

  rerender(<ForYouFeedRow detected activity={null} />);

  expect(container.querySelector(".for-you-detected-summary")).not.toBeNull();
  expect(container.querySelector(".row-action.is-leaving")).not.toBeNull();
});
