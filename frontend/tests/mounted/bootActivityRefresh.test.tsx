import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { useActivityStrip } from "../../src/desk/useActivityStrip";
import { useDeskBoot } from "../../src/desk/useDeskBoot";
import type { ActivityBucket } from "../../src/lib/activityStats";
import { deferred } from "./support/deferred";

vi.mock("../../src/desk/watch", () => ({
  ensureActivitySubscribe: vi.fn(), watchDeskThreads: vi.fn(),
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});

const user = { id: "owner", onboardingCompleted: true };

function stats(bucket: ActivityBucket, views: number) {
  return {
    bucket,
    series: [{ period: "2026-09-28", interactions: 1, originals: 0, quotes: 0, replies: 1, views, withStats: 1 }],
    totals: { interactions: 1, originals: 0, quotes: 0, replies: 1, views, withStats: 1 },
  };
}

function statsUrls(fetcher: ReturnType<typeof vi.fn>): string[] {
  return fetcher.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/api/interacted/stats"))
    .map((url) => url.slice(url.indexOf("/api/interacted/stats")));
}

function mountDesk() {
  return renderHook(() => {
    const session = useSession();
    const generation = session.capture();
    const strip = useActivityStrip(null);
    const noop = async () => {};
    const boot = useDeskBoot({
      dedupeAccounts: true, setAgenda: vi.fn(), setAuthNotice: vi.fn(),
      setBillingNotice: vi.fn(), setView: vi.fn(), setSignInOpen: vi.fn(),
      applyAuthUser: (next, required = true) => session.verify(next, required, generation),
      applyDesk: (desk) => strip.applyStripFromBoot(desk),
      confirmCheckout: noop, hydrateCoaching: noop,
      hydrateActivityStats: strip.hydrateActivityStats, loadBilling: noop, hydrateVoice: noop,
      loadUsage: noop, loadAdmin: noop, hydrateScoutFamiliarity: noop,
    });
    return { strip, ready: boot.deskBootReady };
  }, { wrapper: SessionBoundary });
}

test("a successful boot paints stored stats, then refreshes them once after paint", async () => {
  const live = deferred<Response>();
  const fetcher = vi.fn((url: string) => {
    if (url.includes("/api/boot?")) {
      return Promise.resolve(Response.json({ ok: true, user, desk: { activityStats: stats("day", 10) } }));
    }
    if (url.includes("/api/interacted/stats")) return live.promise;
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountDesk();
  await act(async () => {});
  expect(h.result.current.ready).toBe(true);
  expect(h.result.current.strip.activityStats.totals.views).toBe(10);
  expect(statsUrls(fetcher)).toEqual(["/api/interacted/stats?bucket=day"]);
  await act(async () => { live.resolve(Response.json(stats("day", 50))); });
  expect(h.result.current.strip.activityStats.totals.views).toBe(50);
  expect(h.result.current.strip.activityBucket).toBe("day");
  expect(statsUrls(fetcher)).toEqual(["/api/interacted/stats?bucket=day"]);
});

test("a bucket switch during the post-paint refresh wins over the late day response", async () => {
  const day = deferred<Response>();
  const week = deferred<Response>();
  const fetcher = vi.fn((url: string) => {
    if (url.includes("/api/boot?")) {
      return Promise.resolve(Response.json({ ok: true, user, desk: { activityStats: stats("day", 10) } }));
    }
    if (url.includes("/api/interacted/stats?bucket=day")) return day.promise;
    if (url.includes("/api/interacted/stats?bucket=week")) return week.promise;
    return Promise.resolve(Response.json({ ok: true }));
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountDesk();
  await act(async () => {});
  act(() => { h.result.current.strip.onActivityBucket("week"); });
  await act(async () => { week.resolve(Response.json(stats("week", 70))); });
  await act(async () => { day.resolve(Response.json(stats("day", 50))); });
  expect(h.result.current.strip.activityBucket).toBe("week");
  expect(h.result.current.strip.activityStats.totals.views).toBe(70);
});
