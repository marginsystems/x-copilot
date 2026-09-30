import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CirclePanel } from "../../src/desk/CirclePanel";

vi.mock("../../src/lib/circleShare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/circleShare")>();
  return {
    ...actual,
    loadCircleImages: vi.fn().mockResolvedValue(new Map()),
  };
});

function circleResponse(people: number) {
  return {
    handle: "me",
    name: "Me",
    avatarUrl: null,
    generatedAt: "2026-09-30T12:00:00Z",
    members: Array.from({ length: people }, (_, i) => ({
      handle: `friend_${i}`,
      name: `Friend ${i}`,
      avatarUrl: null as string | null,
      replies: 10 - (i % 10),
      quotes: 0,
      score: 10 - (i % 10),
      lastAt: "2026-09-29T10:00:00Z",
    })),
    totals: { replies: people * 10, quotes: 0, people: people === 70 ? 180 : people },
  };
}

test("shows a fetch failure instead of the minimum-member empty state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
  render(<CirclePanel refreshKey="" />);
  expect(await screen.findByText("Could not load your circle. Refresh the desk to try again.")).toBeTruthy();
  expect(screen.queryByText(/draw your circle/)).toBeNull();
});

test("keeps a genuine under-minimum response in the empty state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(2))));
  render(<CirclePanel refreshKey="" />);
  expect(await screen.findByText("Reply to more people to draw your circle (2 of 3).")).toBeTruthy();
});

test("mounts one bubble map canvas from the skeleton through the loaded circle", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(70))));
  const { container } = render(<CirclePanel refreshKey="" />);
  const canvas = container.querySelector("canvas");
  expect(canvas).toBeTruthy();
  expect(canvas!.getAttribute("aria-hidden")).toBe("true");
  const map = await screen.findByRole("img", { name: /Bubble map of your X Circle, 64 people\. Closest: @friend_0/ });
  expect(map).toBe(canvas);
  expect(container.querySelectorAll("canvas")).toHaveLength(1);
  expect(screen.getByText("64 people · 700 replies")).toBeTruthy();
});

test("ranks ten people with avatars, initial fallbacks, bars and no zero counts", async () => {
  const payload = circleResponse(12);
  payload.members[0] = { ...payload.members[0]!, avatarUrl: "https://img.test/a.png", replies: 15, quotes: 2 };
  payload.members[1] = { ...payload.members[1]!, replies: 0, quotes: 3 };
  payload.members[2] = { ...payload.members[2]!, replies: 8, quotes: 0 };
  payload.totals = { replies: 843, quotes: 12, people: 12 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
  const { container } = render(<CirclePanel refreshKey="" />);
  const list = await screen.findByRole("list", { name: "Closest" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(10);
  expect(screen.getByText("12 people · 843 replies · 12 quotes")).toBeTruthy();
  const cells = (row: HTMLElement) => [
    row.querySelector(".desk-circle-replies")?.textContent,
    row.querySelector(".desk-circle-quotes")?.textContent,
  ];
  expect(cells(rows[0]!)).toEqual(["15", "2q"]);
  expect(cells(rows[1]!)).toEqual(["", "3q"]);
  expect(cells(rows[2]!)).toEqual(["8", ""]);
  expect(rows[2]!.querySelector(".desk-circle-quotes")).toBeTruthy();
  expect(rows[0]!.querySelector("img.desk-circle-avatar")).toBeTruthy();
  expect(rows[1]!.querySelector(".desk-circle-avatar.is-initial")?.textContent).toBe("F");
  const bars = container.querySelectorAll<HTMLElement>(".desk-circle-bar-replies");
  expect(bars[0]!.style.width).toBe("78.94736842105263%");
});

test("expands the map over the list and collapses with the button or Escape", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(6))));
  const user = userEvent.setup();
  const { container } = render(<CirclePanel refreshKey="" />);
  const expand = await screen.findByRole("button", { name: "Expand the circle map" });
  const canvas = container.querySelector("canvas");
  const body = container.querySelector(".desk-circle-body")!;
  expect(body.classList.contains("is-expanded")).toBe(false);
  await user.click(expand);
  expect(body.classList.contains("is-expanded")).toBe(true);
  expect(container.querySelector("canvas")).toBe(canvas);
  const collapse = screen.getByRole("button", { name: "Collapse the circle map" });
  expect(collapse.getAttribute("aria-pressed")).toBe("true");
  await user.keyboard("{Escape}");
  expect(body.classList.contains("is-expanded")).toBe(false);
  await user.click(screen.getByRole("button", { name: "Expand the circle map" }));
  await user.click(screen.getByRole("button", { name: "Collapse the circle map" }));
  expect(body.classList.contains("is-expanded")).toBe(false);
  expect(container.querySelector("canvas")).toBe(canvas);
});

test("keeps the share actions and no longer opens a card dialog", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(6))));
  render(<CirclePanel refreshKey="" />);
  expect(await screen.findByRole("link", { name: "Post on X" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Download PNG" })).toBeTruthy();
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("keeps the frame with a ghost map and progress while the circle is too small", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(1))));
  const { container } = render(<CirclePanel refreshKey="" />);
  expect(await screen.findByText("Reply to more people to draw your circle (1 of 3).")).toBeTruthy();
  expect(container.querySelector(".desk-circle-map.is-ghost canvas")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Circle" })).toBeTruthy();
});
