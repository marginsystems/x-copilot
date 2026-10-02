import { render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { expect, test, vi } from "vitest";
import DeskView from "../../src/desk/DeskView";

vi.mock("../../src/desk/ThreadsTabs", () => ({
  ThreadsTabs: () => <div data-testid="threads" />,
}));
vi.mock("../../src/desk/DeskTop", () => ({
  DeskTop: () => <div data-testid="cockpit" />,
}));

type Props = ComponentProps<typeof DeskView>;

test("desk renders the threads section before the cockpit", () => {
  const top = vi.fn<() => Props["top"]>()();
  const tabs = vi.fn<() => Props["tabs"]>()();
  const { container } = render(<DeskView top={top} tabs={tabs} />);
  const order = [...container.querySelectorAll(".desk > [data-testid]")].map(
    (node) => node.getAttribute("data-testid"),
  );
  expect(order).toEqual(["threads", "cockpit"]);
});
