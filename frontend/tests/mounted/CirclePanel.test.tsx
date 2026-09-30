import { render, screen } from "@testing-library/react";
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
      avatarUrl: null,
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
  expect(screen.queryByText(/at least 3 people/)).toBeNull();
});

test("keeps a genuine under-minimum response in the empty state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(circleResponse(2))));
  render(<CirclePanel refreshKey="" />);
  expect(await screen.findByText(/at least 3 people/)).toBeTruthy();
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
  expect(screen.getByText("64 people")).toBeTruthy();
});
