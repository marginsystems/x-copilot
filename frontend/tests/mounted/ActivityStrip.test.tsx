import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { ActivityStrip } from "../../src/desk/ActivityStrip";
import { emptyActivityStats, type ActivityStats } from "../../src/lib/activityStats";
import { emptyGamificationStats } from "../../src/lib/gamification";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

const stats: ActivityStats = {
  ...emptyActivityStats("day"),
  totals: { interactions: 307, originals: 20, quotes: 10, replies: 277, views: 1175401, withStats: 300 },
  series: [
    { period: "2026-09-29", interactions: 4, originals: 1, quotes: 0, replies: 3, views: 1200, withStats: 4 },
    { period: "2026-09-30", interactions: 6, originals: 0, quotes: 1, replies: 5, views: 3400, withStats: 6 },
  ],
};

test("shows one clean chip row with thousands separators and XP left to the next level", () => {
  render(
    <ActivityStrip
      activityBucket="day"
      activityStats={stats}
      gamification={{
        ...emptyGamificationStats(),
        level: 46,
        xpIntoLevel: 84,
        xpToNext: 91,
        currentStreak: 31,
        longestStreak: 31,
      }}
      onActivityBucket={vi.fn()}
    />,
  );
  expect(screen.getByText("307 posts · 1,175,401 views")).toBeTruthy();
  expect(screen.getByText(/Streak 31/)).toBeTruthy();
  expect(screen.getByText(/7 XP to Lv 47/)).toBeTruthy();
  expect(screen.getByRole("group", { name: "Activity bucket" })).toBeTruthy();
  expect(screen.getByLabelText("Post kinds")).toBeTruthy();
});

test("makes each chart column reachable from the keyboard for its tooltip", () => {
  const { container } = render(
    <ActivityStrip
      activityBucket="day"
      activityStats={stats}
      gamification={emptyGamificationStats()}
      onActivityBucket={vi.fn()}
    />,
  );
  const hits = container.querySelectorAll(".activity-chart-hit");
  expect(hits.length).toBe(2);
  for (const hit of hits) expect(hit.getAttribute("tabindex")).toBe("0");
});
