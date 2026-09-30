import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { CirclePanel } from "../../src/desk/CirclePanel";
import { renderCircleShareBlob } from "../../src/lib/circleShare";

vi.mock("../../src/lib/circleShare", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/circleShare")>();
  return {
    ...actual,
    loadCircleImages: vi.fn().mockResolvedValue(new Map()),
    renderCircleShareBlob: vi.fn().mockResolvedValue(new Blob(["card"], { type: "image/png" })),
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

test("reports render failures and reserves preview dimensions before the blob resolves", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(circleResponse(70)))
      .mockResolvedValueOnce(Response.json(circleResponse(70))),
  );
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:circle"),
    revokeObjectURL: vi.fn(),
  });
  vi.mocked(renderCircleShareBlob).mockRejectedValueOnce(new Error("canvas failed"));
  const { rerender } = render(<CirclePanel refreshKey="" />);
  expect(await screen.findByText("Could not load your circle. Refresh the desk to try again.")).toBeTruthy();
  vi.mocked(renderCircleShareBlob).mockResolvedValueOnce(new Blob(["card"], { type: "image/png" }));
  rerender(<CirclePanel refreshKey="new-reply" />);
  const preview = await screen.findByRole("img", { name: "X Circle card with 64 people" });
  expect(preview.getAttribute("width")).toBe("1080");
  expect(preview.getAttribute("height")).toBe("1350");
  expect(screen.getByText("64 people · 700 replies")).toBeTruthy();
});

test("ranks ten people with avatars, initial fallbacks, bars and no zero counts", async () => {
  const payload = circleResponse(12);
  payload.members[0] = { ...payload.members[0]!, avatarUrl: "https://img.test/a.png", replies: 15, quotes: 2 };
  payload.members[1] = { ...payload.members[1]!, replies: 0, quotes: 3 };
  payload.members[2] = { ...payload.members[2]!, replies: 8, quotes: 0 };
  payload.totals = { replies: 843, quotes: 12, people: 12 };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:circle"), revokeObjectURL: vi.fn() });
  const { container } = render(<CirclePanel refreshKey="" />);
  const list = await screen.findByRole("list", { name: "Closest" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows).toHaveLength(10);
  expect(screen.getByText("12 people · 843 replies · 12 quotes")).toBeTruthy();
  expect(rows[0]!.textContent).toContain("15 · 2q");
  expect(rows[1]!.textContent).toContain("3q");
  expect(rows[1]!.textContent).not.toContain("0");
  expect(rows[2]!.textContent).toContain("8");
  expect(rows[2]!.textContent).not.toContain("q");
  expect(rows[0]!.querySelector("img.desk-circle-avatar")).toBeTruthy();
  expect(rows[1]!.querySelector(".desk-circle-avatar.is-initial")?.textContent).toBe("F");
  const bars = container.querySelectorAll<HTMLElement>(".desk-circle-bar-replies");
  expect(bars[0]!.style.width).toBe("78.94736842105263%");
});

test("opens the full-size card from the thumbnail and closes it with Escape", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(6))));
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:circle"), revokeObjectURL: vi.fn() });
  const user = userEvent.setup();
  render(<CirclePanel refreshKey="" />);
  const thumb = await screen.findByRole("button", { name: "Open the X Circle card at full size" });
  await user.click(thumb);
  const dialog = await screen.findByRole("dialog", { name: "Your X Circle card" });
  expect(within(dialog).getByRole("link", { name: "Post on X" })).toBeTruthy();
  expect(within(dialog).getByRole("button", { name: "Download PNG" })).toBeTruthy();
  expect(within(dialog).getByRole("img", { name: /Full size X Circle card with 6 people/ })).toBeTruthy();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("keeps the frame with a ghost ring and progress while the circle is too small", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(1))));
  const { container } = render(<CirclePanel refreshKey="" />);
  expect(await screen.findByText("Reply to more people to draw your circle (1 of 3).")).toBeTruthy();
  expect(container.querySelectorAll(".desk-circle-thumb.is-ghost circle")).toHaveLength(36);
  expect(screen.getByRole("region", { name: "Circle" })).toBeTruthy();
});
