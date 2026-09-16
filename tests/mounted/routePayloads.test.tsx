import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { Account } from "../../src/Account";
import { Analytics } from "../../src/Analytics";
import { RootBoundary } from "../../src/RootBoundary";
import { SessionBoundary, useSession } from "../../src/auth/session";
import { useBilling } from "../../src/billing/useBilling";
import { useUsage } from "../../src/usage/useUsage";
import { parseAccount, parseAnalytics, parseBilling, parseUsage, parseSessions } from "../../src/lib/routePayloads";
import { deferred } from "./support/deferred";

const account = { ok: true, user: { displayName: "Reader", email: null, avatarUrl: null, xUsername: null }, providers: [], sessions: [] };
const analytics = { ok: true, totals: { posts: 1, originals: 1, replies: 0, quotes: 0, reposts: 0, views: 123, likes: 0, replyCount: 0, retweets: 0, bookmarks: 0 }, series: [], kinds: [], top: [] };
const usage = { ok: true, window: "7d", calls: 1, creditsUsed: 2, creditLimit: 100, remaining: 98, recent: [] };
const billing = { ok: true, plan_key: "free", credits: { used: 2, limit: 100, remaining: 98, can_use: true } };

test("endpoint parsers reject missing fields, wrong containers and malformed nested values", () => {
  for (const parse of [parseAccount, parseAnalytics, parseBilling, parseUsage, parseSessions]) {
    for (const bad of [null, [], {}, "html", { ok: false }, { ok: true }]) expect(parse(bad)).toBeNull();
  }
  expect(parseSessions({ ok: true, signedOut: true })).toEqual({ signedOut: true, sessions: [] });
  expect(parseAccount(account)).toEqual(account);
  expect(parseAnalytics(analytics)).toEqual(analytics);
  expect(parseUsage(usage)).toEqual(usage);
  expect(parseBilling(billing)).toEqual(billing);
  for (const bad of [{ providers: {} }, { sessions: [null] }, { user: { ...account.user, displayName: {} } }, { providers: [{ provider: "x", username: {}, email: null }] }]) expect(parseAccount({ ...account, ...bad })).toBeNull();
  for (const bad of [{ series: {} }, { totals: {} }, { top: [{}] }, { kinds: [null] }, { insight: { headline: "Hi", day: "today", createdAt: "now", bullets: [{}] } }]) expect(parseAnalytics({ ...analytics, ...bad })).toBeNull();
  for (const bad of [{ recent: {} }, { recent: [{}] }, { remaining: {} }, { note: {} }]) expect(parseUsage({ ...usage, ...bad })).toBeNull();
  for (const bad of [{ credits: undefined }, { credits: {} }, { plans: [] }, { plans: { free: {} } }, { first_week_pulse: [] }, { subscription: null }, { plan_key: {} }]) expect(parseBilling({ ...billing, ...bad })).toBeNull();
});

test.each(["account", "analytics"])("%s keeps good data after malformed and non-JSON refresh and recovers", async (route) => {
  const good = route === "account" ? account : analytics;
  const fetchMock = vi.fn().mockResolvedValue(Response.json(good));
  vi.stubGlobal("fetch", fetchMock);
  render(route === "account" ? <Account onBack={vi.fn()} onGoogle={vi.fn()} onX={vi.fn()} onSignedOut={vi.fn()} /> : <Analytics onBack={vi.fn()} />, { wrapper: SessionBoundary });
  const marker = route === "account" ? "Reader" : "123";
  await screen.findByText(marker);
  for (const response of [Response.json(null), new Response("<html>failed</html>"), Response.json({ message: "Unavailable" }, { status: 503 })]) {
    fetchMock.mockResolvedValueOnce(response);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Refresh" }).hasAttribute("disabled")).toBe(false));
    expect(screen.getByText(marker)).toBeTruthy();
    expect(document.querySelector(".danger")?.textContent).toBeTruthy();
  }
  fetchMock.mockResolvedValueOnce(Response.json(good));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await waitFor(() => expect(document.querySelector(".danger")).toBeNull());
});

test.each(["usage", "billing"])("%s retains data on failure, recovers, and ignores expired work", async (route) => {
  const good = route === "usage" ? usage : billing;
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => {
    const u = useUsage(); const b = useBilling(); const session = useSession();
    return { load: route === "usage" ? u.loadUsage : b.loadBilling, data: route === "usage" ? u.usage : b.billing, error: route === "usage" ? u.usageStatus : b.billingNotice, session };
  }, { wrapper: SessionBoundary });
  fetchMock.mockResolvedValueOnce(Response.json(good));
  await act(async () => { await result.current.load(); });
  expect(result.current.data).toEqual(good);
  for (const response of [Response.json(null), new Response("not JSON"), Response.json({ message: "Unavailable" }, { status: 503 })]) {
    fetchMock.mockResolvedValueOnce(response);
    await act(async () => { await result.current.load(); });
    expect(result.current.data).toEqual(good);
    expect(result.current.error).toBeTruthy();
  }
  fetchMock.mockResolvedValueOnce(Response.json(good));
  await act(async () => { await result.current.load(); });
  expect(result.current.error).toBe("");
  const late = deferred<Response>();
  fetchMock.mockReturnValueOnce(late.promise);
  let pending: Promise<void>;
  act(() => { pending = result.current.load(); });
  act(() => { result.current.session.invalidate(); });
  await act(async () => { late.resolve(Response.json(good)); await pending; });
  expect(result.current.data).toBeNull();
});

test("account treats a non-JSON 401 as sign-out", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
  const onSignedOut = vi.fn();
  render(<Account onBack={vi.fn()} onGoogle={vi.fn()} onX={vi.fn()} onSignedOut={onSignedOut} />, { wrapper: SessionBoundary });
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
});

test("account digest preference 401 signs out", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ ...account, mail: { digestEmailOptIn: false, digestEmailAvailable: true } }))
    .mockResolvedValueOnce(new Response("Unauthorized", { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  const onSignedOut = vi.fn();
  render(<Account onBack={vi.fn()} onGoogle={vi.fn()} onX={vi.fn()} onSignedOut={onSignedOut} />, { wrapper: SessionBoundary });
  const toggle = await screen.findByRole("checkbox");
  fireEvent.click(toggle);
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("root render failure leaves recovery controls", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  function Broken(): never { throw new Error("render failure"); }
  render(<RootBoundary><Broken /></RootBoundary>);
  expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Back to home" }).getAttribute("href")).toBe("/");
});

test.each(["account", "analytics"])("%s can recover from an invalid first response", async (route) => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal("fetch", fetchMock);
  render(route === "account" ? <Account onBack={vi.fn()} onGoogle={vi.fn()} onX={vi.fn()} onSignedOut={vi.fn()} /> : <Analytics onBack={vi.fn()} />, { wrapper: SessionBoundary });
  await waitFor(() => expect(document.querySelector(".danger")?.textContent).toContain("invalid response"));
  fetchMock.mockResolvedValueOnce(Response.json(route === "account" ? account : analytics));
  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText(route === "account" ? "Reader" : "123");
  expect(document.querySelector(".danger")).toBeNull();
});

test("malformed revocation preserves sessions without replaying the mutation", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ...account, sessions: [{ id: "device", browser: "Test browser", os: "Test OS", createdAt: "2026-09-01", lastSeenAt: "2026-09-01", ip: null, current: false }] })).mockResolvedValueOnce(Response.json({ ok: true, sessions: {} }));
  vi.stubGlobal("fetch", fetchMock);
  render(<Account onBack={vi.fn()} onGoogle={vi.fn()} onX={vi.fn()} onSignedOut={vi.fn()} />, { wrapper: SessionBoundary });
  await screen.findByText(/Test browser/);
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  await screen.findByText(/Revoke failed/);
  expect(screen.getByText(/Test browser/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("malformed checkout confirmation reports failure without a follow-up request", async () => {
  const fetchMock = vi.fn().mockResolvedValueOnce(Response.json(null));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(useBilling, { wrapper: SessionBoundary });
  await act(async () => { await result.current.confirmCheckout("checkout"); });
  expect(result.current.billingNotice).toContain("Could not confirm");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
