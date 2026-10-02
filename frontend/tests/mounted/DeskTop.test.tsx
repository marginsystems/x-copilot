import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { DeskTop } from "../../src/desk/DeskTop";
import { emptyActivityStats } from "../../src/lib/activityStats";
import { emptyGamificationStats } from "../../src/lib/gamification";
import { deferred } from "./support/deferred";
import { stubFetch } from "./support/requests";

vi.mock("../../src/lib/circleShare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/circleShare")>();
  return {
    ...actual,
    loadCircleImages: vi.fn().mockResolvedValue(new Map()),
    renderCircleShareBlob: vi.fn().mockResolvedValue(new Blob(["card"], { type: "image/png" })),
  };
});

const circle = {
  handle: "me",
  name: "Me",
  avatarUrl: null,
  generatedAt: "2026-09-30T12:00:00Z",
  members: Array.from({ length: 5 }, (_, i) => ({
    handle: `friend_${i}`,
    name: `Friend ${i}`,
    avatarUrl: null,
    replies: 9 - i,
    quotes: 0,
    score: 9 - i,
    lastAt: "2026-09-29T10:00:00Z",
  })),
  totals: { replies: 35, quotes: 0, people: 5 },
};

function Harness({ initialOpen }: { initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <DeskTop
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      activityBucket="day"
      activityStats={emptyActivityStats("day")}
      gamification={emptyGamificationStats()}
      interactedRetainedHistory={[]}
      usableScoutCount={0}
      onActivityBucket={vi.fn()}
    />
  );
}

test("shows instruments, flight path and circle together with no tabs", async () => {
  const requests = stubFetch(vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 503 })));
  render(<Harness initialOpen />);
  expect(screen.getByRole("region", { name: "Instruments" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Flight path" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Circle" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Desk panel" })).toBeNull();
  for (const label of ["Replies / hour", "Replies today", "OG today", "Posts / day", "Tank", "Inbound quiet"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  await requests.settle();
  expect(screen.getByText("Could not load your circle. Refresh the desk to try again.")).toBeTruthy();
});

test("the circle keeps one frame from skeleton to loaded card", async () => {
  const pending = deferred<Response>();
  const requests = stubFetch(vi.fn<typeof fetch>(() => pending.promise));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:circle"), revokeObjectURL: vi.fn() });
  render(<Harness initialOpen />);
  const frame = screen.getByRole("region", { name: "Circle" });
  expect(frame.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByText("Drawing your circle…")).toBeTruthy();
  await act(async () => {
    pending.resolve(Response.json(circle));
  });
  await requests.settle();
  expect(screen.getByRole("img", { name: /Bubble map of your X Circle, 5 people/ })).toBeTruthy();
  const loaded = screen.getByRole("region", { name: "Circle" });
  expect(loaded).toBe(frame);
  expect(loaded.getAttribute("aria-busy")).toBe("false");
  expect(screen.getByText("5 people · 35 replies")).toBeTruthy();
});

test("a collapsed cockpit mounts nothing until it is first opened", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<Harness initialOpen={false} />);
  expect(screen.queryByRole("region", { name: "Circle" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Show cockpit" }));
  expect(screen.getByRole("region", { name: "Circle" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Instruments" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Hide cockpit" }));
  expect(screen.getByRole("button", { name: "Show cockpit" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("region", { name: "Circle", hidden: true })).toBeTruthy();
});

test("the toggle is one element with a fixed-width label across both states", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
  const user = userEvent.setup();
  render(<Harness initialOpen />);
  const toggle = screen.getByRole("button", { name: "Hide cockpit" });
  const sizer = toggle.querySelector(".desk-top-toggle-sizer");
  expect(sizer?.textContent).toBe("Show cockpit");
  expect(sizer?.getAttribute("aria-hidden")).toBe("true");
  await user.click(toggle);
  expect(screen.getByRole("button", { name: "Show cockpit" })).toBe(toggle);
  expect(toggle.querySelector(".desk-top-toggle-sizer")).toBe(sizer);
  expect(screen.getByRole("heading", { name: "Cockpit", hidden: true })).toBeTruthy();
});

test("a collapsed cockpit body is inert and aria-hidden, and reopens live", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
  const user = userEvent.setup();
  const { container } = render(<Harness initialOpen />);
  const body = container.querySelector(".desk-top-body");
  if (!body) throw new Error("missing cockpit body");
  expect(body.hasAttribute("inert")).toBe(false);
  expect(body.getAttribute("aria-hidden")).toBe("false");
  await user.click(screen.getByRole("button", { name: "Hide cockpit" }));
  expect(body.hasAttribute("inert")).toBe(true);
  expect(body.getAttribute("aria-hidden")).toBe("true");
  expect(container.querySelector(".desk-top")?.classList.contains("is-collapsed")).toBe(true);
  await user.click(screen.getByRole("button", { name: "Show cockpit" }));
  expect(body.hasAttribute("inert")).toBe(false);
  expect(container.querySelector(".desk-top")?.classList.contains("is-collapsed")).toBe(false);
});
