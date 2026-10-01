import { render, screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { LearnReadPage } from "../../src/LearnRead";

function changeRow(action: string): HTMLElement {
  const cell = screen.getByText(action, { exact: false, selector: "td" });
  const row = cell.closest("tr");
  if (!row) throw new Error(`no row for ${action}`);
  return row;
}

test("tints and arrows each changed weight by its direction", () => {
  render(<LearnReadPage goToView={() => {}} />);

  const notInterested = changeRow("Not interested");
  expect(notInterested.className).toBe("is-down");
  expect(within(notInterested).getByRole("img", { name: "Went down" }).textContent).toBe("▼");
  expect(within(notInterested).getByText("-47.52")).toBeTruthy();

  const read = changeRow("Stays past 10 s after the tap");
  expect(read.className).toBe("is-up");
  expect(within(read).getByRole("img", { name: "Went up" }).textContent).toBe("▲");
});
