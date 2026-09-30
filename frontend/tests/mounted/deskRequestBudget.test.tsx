import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { DESK_DETECTOR_FALLBACK_MS } from "../../src/desk/approachDetector";
import { routeDeskDetector, useDeskEventStream } from "../../src/desk/deskEventStream";
import { useCoaching } from "../../src/desk/useCoaching";
import { useDeskBoot } from "../../src/desk/useDeskBoot";

vi.mock("../../src/desk/watch", () => ({
  ensureActivitySubscribe: vi.fn(), watchDeskThreads: vi.fn(),
}));

const mission = {
  id: "reply_2", label: "Mark two replies", target: 2, progress: 1,
  xpReward: 10, completed: false, claimed: false,
};
const bootCoaching = {
  dayUtc: "2026-09-28", nextAction: null, missions: [mission],
  beats: { scoutReplyDone: false, organicReplyDone: false, forkChoice: null, forkDone: false },
  postsToday: 1, originalsToday: 0, replyAt: [], originalAt: [], postAt: [],
};
const nextAction = { kind: "reply", text: "Reply to one useful thread.", updatedAt: "2026-09-28T01:00:00.000Z" };
const ownActivity = {
  id: "1900", url: "https://x.com/i/status/1900", text: "Latest post",
  kind: "reply", postedAt: "2026-09-28T01:30:00.000Z",
};
const user = { id: "owner", onboardingCompleted: true };

function coachingUrls(fetcher: ReturnType<typeof vi.fn>): string[] {
  return fetcher.mock.calls
    .map(([url]) => String(url))
    .filter((url) => url.includes("/api/coaching"))
    .map((url) => url.slice(url.indexOf("/api/coaching")));
}

function mountDesk() {
  return renderHook(() => {
    const session = useSession();
    const generation = session.capture();
    const coaching = useCoaching(null);
    const noop = async () => {};
    useDeskBoot({
      dedupeAccounts: true, setAgenda: vi.fn(), setAuthNotice: vi.fn(),
      setBillingNotice: vi.fn(), setView: vi.fn(), setSignInOpen: vi.fn(),
      applyAuthUser: (next, required = true) => session.verify(next, required, generation),
      applyDesk: (desk) => {
        if (desk.coaching !== undefined) coaching.applyCoaching(desk.coaching);
      },
      confirmCheckout: noop, hydrateCoaching: coaching.hydrateCoaching,
      hydrateActivityStats: noop, loadBilling: noop,
      loadUsage: noop, loadAdmin: noop, hydrateScoutFamiliarity: noop,
    });
    return coaching.coaching;
  }, { wrapper: SessionBoundary });
}

test("a successful boot fetches only the next action, not the full coaching payload", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return Response.json({ ok: true, user, desk: { coaching: bootCoaching } });
    if (url.includes("/api/coaching")) return Response.json({ ok: true, dayUtc: "2026-09-28", nextAction, ownActivity });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountDesk();
  await act(async () => {});
  expect(coachingUrls(fetcher)).toEqual(["/api/coaching?nextAction=1"]);
  expect(h.result.current?.nextAction).toEqual(nextAction);
  expect(h.result.current?.ownActivity).toEqual(ownActivity);
  expect(h.result.current?.missions).toEqual([mission]);
  expect(h.result.current?.postsToday).toBe(1);
});

test("a next action from a new UTC day triggers one full coaching refresh instead of mixing days", async () => {
  const nextDayMission = { ...mission, progress: 0 };
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return Response.json({ ok: true, user, desk: { coaching: bootCoaching } });
    if (url.includes("/api/coaching?nextAction=1")) return Response.json({ ok: true, dayUtc: "2026-09-29", nextAction });
    if (url.includes("/api/coaching")) {
      return Response.json({ ...bootCoaching, ok: true, dayUtc: "2026-09-29", missions: [nextDayMission], postsToday: 0, nextAction });
    }
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountDesk();
  await act(async () => {});
  expect(coachingUrls(fetcher)).toEqual(["/api/coaching?nextAction=1", "/api/coaching"]);
  expect(h.result.current?.dayUtc).toBe("2026-09-29");
  expect(h.result.current?.missions).toEqual([nextDayMission]);
  expect(h.result.current?.postsToday).toBe(0);
  expect(h.result.current?.nextAction).toEqual(nextAction);
});

test("fallback boot still hydrates the full coaching payload once", async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url.includes("/api/boot?")) return new Response(null, { status: 404 });
    if (url.endsWith("/api/auth/me")) return Response.json({ ok: true, user });
    if (url.includes("/api/coaching")) return Response.json({ ok: true, ...bootCoaching, nextAction });
    return Response.json({ ok: true });
  });
  vi.stubGlobal("fetch", fetcher);
  const h = mountDesk();
  await act(async () => {});
  expect(coachingUrls(fetcher)).toEqual(["/api/coaching"]);
  expect(h.result.current?.nextAction).toEqual(nextAction);
  expect(h.result.current?.missions).toEqual([mission]);
});

test("the detector fallback does not poll while the tab is hidden and checks on return", async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const forYou = vi.fn(async () => {});
  const scout = vi.fn(async () => {});
  const unroute = routeDeskDetector({ active: "for_you", check: { for_you: forYou, scout }, forYouOwnPost: vi.fn() });
  const h = renderHook(() => useDeskEventStream(null));
  await act(async () => { vi.advanceTimersByTime(DESK_DETECTOR_FALLBACK_MS * 4); });
  expect(forYou).not.toHaveBeenCalled();
  visibility.mockReturnValue("visible");
  await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
  expect(forYou).toHaveBeenCalledTimes(1);
  await act(async () => { vi.advanceTimersByTime(DESK_DETECTOR_FALLBACK_MS); });
  expect(forYou).toHaveBeenCalledTimes(2);
  await act(async () => { window.dispatchEvent(new Event("focus")); });
  expect(forYou).toHaveBeenCalledTimes(3);
  expect(scout).not.toHaveBeenCalled();
  h.unmount();
  unroute();
});
