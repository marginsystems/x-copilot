import { StrictMode, type ReactNode } from "react";
import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { ScoutFamiliarity } from "../../src/desk/ScoutFamiliarity";
import { useScoutFamiliarity } from "../../src/desk/useScoutFamiliarity";
import {
  clearDeskBootCache,
  parseDeskBoot,
  peekDeskBootCache,
  writeDeskBootCache,
} from "../../src/lib/deskBoot";
import type { ScoutFamiliarity as Familiarity } from "../../src/lib/scoutFamiliarity";
import { deferred } from "./support/deferred";

const EMPTY: Familiarity = {
  state: "empty", version: 1, revision: 0, score: 0,
  coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 0 },
  biases: [], hints: [], lastLearned: null, updatedAt: null,
};
const LEARNING: Familiarity = {
  ...EMPTY, state: "learning", revision: 2,
  coverage: { storedConfirmedReplies: 1, knownKindResolvedActions: 1 },
  lastLearned: { at: "2026-09-20T10:00:01.000Z", action: "take", threadKind: "fact_add" },
  updatedAt: "2026-09-20T10:00:01.000Z",
};
const SUPPORTED: Familiarity = {
  state: "supported", version: 1, revision: 10, score: 13,
  coverage: { storedConfirmedReplies: 5, knownKindResolvedActions: 10 },
  biases: [
    { kind: "fact_add", bias: "prefer", takes: 5, skips: 0 },
    { kind: "hollow_ask", bias: "avoid", takes: 0, skips: 5 },
  ],
  hints: [],
  lastLearned: { at: "2026-09-20T10:00:10.000Z", action: "skip", threadKind: "hollow_ask" },
  updatedAt: "2026-09-20T10:00:10.000Z",
};
const NEUTRAL: Familiarity = { ...SUPPORTED, revision: 11, biases: [], lastLearned: null };
const HINTS: Familiarity = {
  ...SUPPORTED, revision: 12, score: 0, biases: [],
  coverage: { storedConfirmedReplies: 3, knownKindResolvedActions: 0 },
  hints: [
    { category: "author", value: "alice", distinctTargets: 3 },
    { category: "topic", value: "rates", distinctTargets: 3 },
  ],
  lastLearned: { at: "2026-09-20T10:00:03.000Z", action: "take", threadKind: null },
};

const userA = { id: "owner-a", onboardingCompleted: true };
const userB = { id: "owner-b", onboardingCompleted: true };
const bootFor = (user: { id: string }, scoutFamiliarity?: Familiarity | null) =>
  parseDeskBoot({ ok: true, user, desk: scoutFamiliarity === undefined ? {} : { scoutFamiliarity } })!;
const profile = (scoutFamiliarity: Familiarity | null) => Response.json({ ok: true, scoutFamiliarity });

beforeEach(() => {
  clearDeskBootCache();
});

// ---------------------------------------------------------------- component

test("null renders no meter and no learned claims", () => {
  const { container } = render(<ScoutFamiliarity familiarity={null} />);
  expect(container.innerHTML).toBe("");
  expect(screen.queryByText(/Scout familiarity/)).toBeNull();
});

test("empty state shows the coverage meter, explanation and empty copy only", () => {
  render(<ScoutFamiliarity familiarity={EMPTY} />);
  const meter = screen.getByRole("meter", { name: "Scout familiarity" });
  expect(meter.getAttribute("aria-valuenow")).toBe("0");
  expect(meter.getAttribute("aria-valuemin")).toBe("0");
  expect(meter.getAttribute("aria-valuemax")).toBe("100");
  expect(meter.getAttribute("aria-valuetext")).toBe(
    "0 of 100 coverage · 0 stored confirmed replies · 0 known-kind resolved actions",
  );
  expect(meter.getAttribute("aria-describedby")).toBeTruthy();
  expect(screen.getByText(/takes and skips with a known thread kind/)).toBeTruthy();
  expect(screen.getByText(/evidence coverage, not accuracy or XP/)).toBeTruthy();
  expect(screen.getByText("Confirmed replies build familiarity.")).toBeTruthy();
  expect(screen.queryByText("Learning.")).toBeNull();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(/Last learned/)).toBeNull();
});

test("learning state shows singular counts and a factual last-learned line", () => {
  render(<ScoutFamiliarity familiarity={LEARNING} />);
  expect(screen.getByRole("meter").getAttribute("aria-valuetext")).toBe(
    "0 of 100 coverage · 1 stored confirmed reply · 1 known-kind resolved action",
  );
  expect(screen.getByText("Learning.")).toBeTruthy();
  expect(screen.getByText("Last learned: take · fact add · 2026-09-20 10:00 UTC")).toBeTruthy();
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(/ago/)).toBeNull();
});

test("supported directional lists kinds with explicit counts and no hints", () => {
  render(<ScoutFamiliarity familiarity={SUPPORTED} />);
  expect(screen.getByRole("meter").getAttribute("aria-valuenow")).toBe("13");
  const kinds = screen.getByRole("list", { name: "Supported kinds" });
  expect(Array.from(kinds.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
    "Prefer · fact add · 5 takes · 0 skips",
    "Avoid · open question · 0 takes · 5 skips",
  ]);
  expect(screen.queryByRole("list", { name: "Supported hints" })).toBeNull();
  expect(screen.queryByText("Learning.")).toBeNull();
  expect(screen.queryByText("Confirmed replies build familiarity.")).toBeNull();
  expect(screen.getByText("Last learned: skip · open question · 2026-09-20 10:00 UTC")).toBeTruthy();
});

test("supported neutral-only makes no claim; hint-only keeps category and target count", () => {
  const neutral = render(<ScoutFamiliarity familiarity={NEUTRAL} />);
  expect(screen.queryByRole("list")).toBeNull();
  expect(screen.queryByText(/Prefer|Avoid|Learning\.|Last learned/)).toBeNull();
  neutral.unmount();
  render(<ScoutFamiliarity familiarity={HINTS} />);
  const hints = screen.getByRole("list", { name: "Supported hints" });
  expect(Array.from(hints.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
    "Author · alice · 3 targets",
    "Topic · rates · 3 targets",
  ]);
  expect(screen.queryByText(/likes|dislikes|Prefer|Avoid/)).toBeNull();
  expect(screen.getByText("Last learned: take · 2026-09-20 10:00 UTC")).toBeTruthy();
});

test("hint text renders as escaped text", () => {
  render(<ScoutFamiliarity familiarity={{
    ...HINTS,
    hints: [{ category: "topic", value: "<img src=x onerror=alert(1)>", distinctTargets: 3 }],
  }} />);
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText(/<img src=x onerror=alert\(1\)>/)).toBeTruthy();
});

// --------------------------------------------------------------------- hook

function wrapper({ children }: { children: ReactNode }) {
  return <StrictMode><SessionBoundary>{children}</SessionBoundary></StrictMode>;
}

function mount(owner: { id: string } | null = userA) {
  const hook = renderHook(() => {
    const session = useSession();
    const verified = session.getSnapshot().user?.id ?? null;
    return { session, ...useScoutFamiliarity(verified) };
  }, { wrapper });
  if (owner) {
    act(() => {
      const generation = hook.result.current.session.capture();
      hook.result.current.session.verify(owner as never, true, generation);
    });
  }
  return hook;
}

function fetchQueue() {
  const requests: ReturnType<typeof deferred<Response>>[] = [];
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    urls.push(url);
    const request = deferred<Response>();
    requests.push(request);
    return request.promise;
  }));
  return { requests, urls };
}

test("seeds from the verified owner's cache only, never from another owner's", () => {
  writeDeskBootCache(bootFor(userA, LEARNING));
  const unverified = mount(null);
  expect(unverified.result.current.scoutFamiliarity).toBeNull();
  unverified.unmount();
  const b = mount(userB);
  expect(b.result.current.scoutFamiliarity).toBeNull();
  b.unmount();
  const { result } = mount(userA);
  expect(result.current.scoutFamiliarity).toEqual(LEARNING);
  clearDeskBootCache();
});

test("boot apply commits the owned slice and updates the owned cache envelope", () => {
  writeDeskBootCache(bootFor(userA));
  const { result } = mount();
  act(() => result.current.applyScoutFamiliarityFromBoot({}));
  expect(result.current.scoutFamiliarity).toBeNull();
  act(() => result.current.applyScoutFamiliarityFromBoot({ scoutFamiliarity: SUPPORTED }));
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
  expect(peekDeskBootCache(userA.id)?.desk?.scoutFamiliarity).toEqual(SUPPORTED);
  expect(peekDeskBootCache(userB.id)).toBeNull();
});

test("refresh fetches the profile endpoint and an older boot cannot regress it", async () => {
  const { requests, urls } = fetchQueue();
  const { result } = mount();
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  expect(urls[0]).toMatch(/\/api\/scout\/profile$/);
  await act(async () => { requests[0].resolve(profile(SUPPORTED)); await refresh; });
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
  act(() => result.current.applyScoutFamiliarityFromBoot({ scoutFamiliarity: LEARNING }));
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
  act(() => result.current.applyScoutFamiliarityFromBoot({ scoutFamiliarity: NEUTRAL }));
  expect(result.current.scoutFamiliarity).toEqual(NEUTRAL);
});

test("same-revision refresh does not rewrite the owned cache", async () => {
  writeDeskBootCache(bootFor(userA, SUPPORTED));
  const { requests } = fetchQueue();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const { result } = mount();
  let refresh!: Promise<void>;

  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[0].resolve(profile(SUPPORTED)); await refresh; });
  const writesAfterFirstRefresh = setItem.mock.calls.length;

  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[1].resolve(profile(SUPPORTED)); await refresh; });

  expect(setItem.mock.calls.length).toBe(writesAfterFirstRefresh);
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
});

test("out-of-order same-owner refreshes keep the latest request's result", async () => {
  const { requests } = fetchQueue();
  const { result } = mount();
  let first!: Promise<void>, latest!: Promise<void>;
  act(() => { first = result.current.hydrateScoutFamiliarity(); latest = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[1].resolve(profile(NEUTRAL)); await latest; });
  await act(async () => { requests[0].resolve(profile(SUPPORTED)); await first; });
  expect(result.current.scoutFamiliarity).toEqual(NEUTRAL);
  // A stale failure cannot clear the newer success either.
  act(() => { first = result.current.hydrateScoutFamiliarity(); latest = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[3].resolve(profile(HINTS)); await latest; });
  await act(async () => { requests[2].resolve(new Response(null, { status: 500 })); await first; });
  expect(result.current.scoutFamiliarity).toEqual(HINTS);
});

test("an unavailable refresh clears the display and owned cache slice; the next refresh recovers", async () => {
  writeDeskBootCache(bootFor(userA, SUPPORTED));
  const { requests } = fetchQueue();
  const { result } = mount();
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[0].resolve(new Response(null, { status: 404 })); await refresh; });
  expect(result.current.scoutFamiliarity).toBeNull();
  expect(peekDeskBootCache(userA.id)?.desk?.scoutFamiliarity).toBeNull();
  expect(peekDeskBootCache(userA.id)?.user?.id).toBe(userA.id);
  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[1].resolve(profile(SUPPORTED)); await refresh; });
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
  // Server null (no permitted projection) is unavailable too, not an empty claim.
  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  await act(async () => { requests[2].resolve(profile(null)); await refresh; });
  expect(result.current.scoutFamiliarity).toBeNull();
});

test("a refresh failure that lands after newer data does not clear it", async () => {
  const { requests } = fetchQueue();
  const { result } = mount();
  let refresh!: Promise<void>;
  act(() => { refresh = result.current.hydrateScoutFamiliarity(); });
  act(() => result.current.applyScoutFamiliarityFromBoot({ scoutFamiliarity: SUPPORTED }));
  await act(async () => { requests[0].reject(new Error("offline")); await refresh; });
  expect(result.current.scoutFamiliarity).toEqual(SUPPORTED);
});

test("switching from A to B during a refresh never exposes or caches A under B", async () => {
  const { requests } = fetchQueue();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const { result } = mount();
  const old = result.current;
  let refresh!: Promise<void>;
  act(() => { refresh = old.hydrateScoutFamiliarity(); });
  act(() => {
    const generation = old.session.capture();
    old.session.verify(userB as never, true, generation);
  });
  expect(result.current.session.getSnapshot().user?.id).toBe(userB.id);
  expect(result.current.scoutFamiliarity).toBeNull();
  await act(async () => { requests[0].resolve(profile(SUPPORTED)); await refresh; });
  expect(result.current.scoutFamiliarity).toBeNull();
  expect(old.scoutFamiliarity).toBeNull();
  expect(peekDeskBootCache(userB.id)).toBeNull();
  expect(setItem.mock.calls.some(([, value]) => String(value).includes("supported"))).toBe(false);
});

test("A's persisted cache stays hidden while B verifies and after B is verified", () => {
  writeDeskBootCache(bootFor(userA, SUPPORTED));
  const { result } = mount(null);
  expect(result.current.scoutFamiliarity).toBeNull();
  act(() => {
    const generation = result.current.session.capture();
    result.current.session.verify(userB as never, true, generation);
  });
  expect(result.current.scoutFamiliarity).toBeNull();
  act(() => result.current.applyScoutFamiliarityFromBoot({ scoutFamiliarity: LEARNING }));
  expect(result.current.scoutFamiliarity).toEqual(LEARNING);
  // B's data never lands in A's envelope.
  expect(peekDeskBootCache(userA.id)?.desk?.scoutFamiliarity).toEqual(SUPPORTED);
  expect(peekDeskBootCache(userB.id)).toBeNull();
});

test.each(["logout", "cross-tab", "unmount"] as const)("%s drops a late refresh and writes nothing", async (end) => {
  const { requests } = fetchQueue();
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const { result, unmount } = mount();
  const old = result.current;
  let refresh!: Promise<void>;
  act(() => { refresh = old.hydrateScoutFamiliarity(); });
  act(() => {
    if (end === "logout") old.session.invalidate("Signed out.", false);
    else if (end === "cross-tab") window.dispatchEvent(new StorageEvent("storage", { key: "x-copilot:session-reset" }));
    else unmount();
  });
  await act(async () => { requests[0].resolve(profile(SUPPORTED)); await refresh; });
  expect(old.scoutFamiliarity).toBeNull();
  if (end !== "unmount") expect(result.current.scoutFamiliarity).toBeNull();
  expect(setItem.mock.calls.some(([key]) => key === "x-copilot-desk-boot-v1")).toBe(false);
});

test("no verified owner performs no refresh request", async () => {
  const { urls } = fetchQueue();
  const { result } = mount(null);
  await act(async () => { await result.current.hydrateScoutFamiliarity(); });
  expect(urls).toEqual([]);
});
