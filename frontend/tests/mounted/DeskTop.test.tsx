import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, test, vi } from "vitest";
import { DeskTop } from "../../src/desk/DeskTop";
import { emptyActivityStats } from "../../src/lib/activityStats";
import { emptyGamificationStats } from "../../src/lib/gamification";
import { deferred } from "./support/deferred";

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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
  render(<Harness initialOpen />);
  expect(screen.getByRole("region", { name: "Instruments" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Flight path" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Circle" })).toBeTruthy();
  expect(screen.queryByRole("group", { name: "Desk panel" })).toBeNull();
  for (const label of ["Replies / hour", "Replies today", "OG today", "Posts / day", "Tank", "Inbound quiet"]) {
    expect(screen.getByText(label)).toBeTruthy();
  }
  expect(await screen.findByText("Could not load your circle. Refresh the desk to try again.")).toBeTruthy();
});

test("the circle keeps one frame from skeleton to loaded card", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:circle"), revokeObjectURL: vi.fn() });
  render(<Harness initialOpen />);
  const frame = screen.getByRole("region", { name: "Circle" });
  expect(frame.getAttribute("aria-busy")).toBe("true");
  expect(screen.getByText("Drawing your circle…")).toBeTruthy();
  await act(async () => {
    pending.resolve(Response.json(circle));
  });
  expect(await screen.findByRole("img", { name: "X Circle card with 5 people" })).toBeTruthy();
  const loaded = screen.getByRole("region", { name: "Circle" });
  expect(loaded).toBe(frame);
  expect(loaded.getAttribute("aria-busy")).toBe("false");
  expect(screen.getByText("5 people")).toBeTruthy();
});

test("a collapsed cockpit mounts nothing until it is first opened", async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json({}, { status: 503 }));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<Harness initialOpen={false} />);
  expect(screen.queryByRole("region", { name: "Circle" })).toBeNull();
  expect(fetchMock).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Expand desk panel" }));
  expect(screen.getByRole("region", { name: "Circle" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Instruments" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Minimize desk panel" }));
  expect(screen.getByRole("button", { name: "Expand desk panel" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.getByRole("region", { name: "Circle", hidden: true })).toBeTruthy();
});
