/// <reference path="../../src/vite-env.d.ts" />
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, afterEach, expect, test, vi } from "vitest";
import App from "../../src/App";
import { DESK_BOOT_KEY, clearDeskBootCache, flushDeskBootWrite, parseDeskBoot, peekDeskBootCache, writeDeskBootCache } from "../../src/lib/deskBoot";
import { SESSION_RESET_KEY } from "../../src/auth/session";
import { deferred } from "./support/deferred";
import { OTHER_OWNER_HINT, OWNER_HINT, setOwnerCookie } from "./support/ownerHint";

vi.mock("../../src/lib/apiBase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/apiBase")>(),
  isLocalHostname: () => false,
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
beforeAll(async () => { await import("../../src/desk/DeskView"); }, 60000);
beforeEach(() => { clearDeskBootCache(); });
afterEach(() => { window.history.replaceState({}, "", "/"); });

const user = { id: "private-owner", displayName: "Private Owner", email: null, avatarUrl: null, agenda: "Private agenda", onboardingCompleted: true, xUsername: "private_handle", xLinked: true, xCanPost: true, isAdmin: false };
const boot = parseDeskBoot({ ok: true, ownerHint: OWNER_HINT, user, desk: {} })!;

test("dashboard reload with cached identity paints only verification until server rejection", async () => {
  window.history.replaceState({}, "", "/dashboard");
  localStorage.setItem(DESK_BOOT_KEY, JSON.stringify(boot));
  expect(localStorage.getItem(DESK_BOOT_KEY)).toContain(OWNER_HINT);
  expect(document.cookie).not.toContain("xc_owner");
  const pending = deferred<Response>();
  const fetchMock = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetchMock);
  const first = render(<App />);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  expect(screen.queryByText("Private Owner")).toBeNull();
  expect(screen.queryByText("Private agenda")).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(peekDeskBootCache(user.id)).toBeNull();
  first.unmount();
  const reload = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => reload.promise));
  render(<App />);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  expect(screen.queryByText("Private Owner")).toBeNull();
  await act(async () => { reload.resolve(Response.json({ ok: false }, { status: 401 })); await reload.promise; });
});

test("Scout autoStart stays off until onboarding is complete", async () => {
  const incomplete = parseDeskBoot({
    ok: true,
    ownerHint: OWNER_HINT,
    user: { ...user, onboardingCompleted: false },
    desk: { lastScout: { ok: true, empty: true } },
  })!;
  const ready = parseDeskBoot({
    ok: true,
    ownerHint: OWNER_HINT,
    user,
    desk: { lastScout: { ok: true, empty: true } },
  })!;
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/boot?")) return Response.json(incomplete);
    return Response.json({ ok: true, empty: true });
  }));
  const first = render(<App />);
  await waitFor(() => expect(screen.queryByText("Checking your session…")).toBeNull());
  expect(urls.some((url) => url.includes("autoStart=1"))).toBe(false);
  first.unmount();
  urls.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/boot?")) return Response.json(ready);
    return Response.json({ ok: true, empty: true });
  }));
  render(<App />);
  await waitFor(() => expect(urls.some((url) => url.includes("autoStart=1"))).toBe(true));
});

test("dashboard shows owned familiarity beside the flight path and hides it after sign-out", async () => {
  window.history.replaceState({}, "", "/dashboard");
  const familiar = parseDeskBoot({
    ok: true,
    ownerHint: OWNER_HINT,
    user,
    desk: {
      scoutFamiliarity: {
        state: "learning", version: 1, revision: 2, score: 0,
        coverage: { storedConfirmedReplies: 1, knownKindResolvedActions: 1 },
        biases: [], hints: [],
        lastLearned: { at: "2026-09-20T10:00:01.000Z", action: "take", threadKind: "fact_add" },
        updatedAt: "2026-09-20T10:00:01.000Z",
      },
    },
  })!;
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/api/boot?")) return Response.json(familiar);
    if (url.endsWith("/api/auth/sessions/current")) return Response.json({ ok: true, signedOut: true });
    return Response.json({ ok: true, empty: true });
  }));
  render(<App />);
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: "Show cockpit" })
      ?? screen.queryByRole("meter", { name: "Scout familiarity" }),
    ).toBeTruthy();
  }, { timeout: 4000 });
  const expand = screen.queryByRole("button", { name: "Show cockpit" });
  if (expand) await userEvent.setup().click(expand);
  await waitFor(() => expect(screen.getByRole("meter", { name: "Scout familiarity" })).toBeTruthy());
  expect(screen.getByText("Learning.")).toBeTruthy();
  expect(screen.getByText(/Streak 0/)).toBeTruthy();
  expect(screen.getByRole("region", { name: "Flight path" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Activity bucket" })).toBeTruthy();
  expect(urls.some((url) => url.endsWith("/api/scout/profile"))).toBe(false);
  expect(peekDeskBootCache(user.id)?.desk?.scoutFamiliarity?.revision).toBe(2);
  const interaction = userEvent.setup();
  await interaction.click(screen.getByRole("button", { name: /menu/i }));
  await interaction.click(await screen.findByRole("button", { name: /sign out|log out/i }));
  await waitFor(() => expect(screen.queryByRole("meter", { name: "Scout familiarity" })).toBeNull());
  expect(peekDeskBootCache(user.id)).toBeNull();
});

test("onboarded dashboard mounts the lazy desk view", async () => {
  window.history.replaceState({}, "", "/dashboard");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/boot?")) return Response.json(boot);
    return Response.json({ ok: true });
  }));

  render(<App />);

  await waitFor(() => {
    expect(screen.getByRole("heading", { name: "Threads" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Approach/ })).toBeTruthy();
  });
  expect(screen.queryByText("Loading page…")).toBeNull();
});

test.each(["401", "revoke"])("Account %s uses the App reset boundary and clears cache", async (mode) => {
  window.history.replaceState({}, "", "/account");
  const interaction = userEvent.setup();
  const account = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/boot?")) return Response.json(boot);
    if (url.endsWith("/api/auth/account")) return account.promise;
    if (url.endsWith("/api/auth/sessions/current")) return Response.json({ ok: true, signedOut: true });
    return Response.json({ ok: false }, { status: 503 });
  }));
  render(<App />);
  await waitFor(() => expect(screen.queryByText("Checking your session…")).toBeNull());
  expect(peekDeskBootCache(user.id)?.user?.id).toBe(user.id);
  await act(async () => {
    account.resolve(mode === "401" ? Response.json({ ok: false }, { status: 401 }) : Response.json({ ok: true, user, providers: [], sessions: [{ id: "current", current: true, browser: "Test browser", os: "Test OS", createdAt: "2026-09-01", lastSeenAt: "2026-09-01", ip: null }] }));
    await account.promise;
  });
  if (mode === "revoke") {
    await interaction.click(screen.getByRole("button", { name: "Revoke" }));
    await interaction.click(screen.getByRole("button", { name: "Confirm" }));
  }
  await waitFor(() => expect(screen.getByText("Signed out.")).toBeTruthy());
  expect(screen.queryByText("Private Owner")).toBeNull();
  expect(peekDeskBootCache(user.id)).toBeNull();
  expect(window.location.pathname).toBe("/");
});

const scoutCard = (id: string, text: string) => ({
  id, author: "@ada", text, summary: text, url: `https://x.com/ada/status/${id}`,
  createdAt: new Date().toISOString(), score: 9, engage: "priority" as const,
});

const cachedUser = { ...user, agenda: "Find builders sharing opinions and concrete technical takes about shipping AI tools." };

function cachedDesk(text: string, owner: Omit<typeof cachedUser, "agenda"> & { agenda: string | null } = cachedUser, hint = OWNER_HINT) {
  return parseDeskBoot({
    ok: true,
    ownerHint: hint,
    user: owner,
    desk: { lastScout: { ok: true, empty: false, snapshot: { savedAt: new Date().toISOString(), threads: [scoutCard("t1", text)] } } },
  })!;
}

function seedCache(payload: ReturnType<typeof cachedDesk>, cookie: string | null = payload.ownerHint) {
  writeDeskBootCache(payload, localStorage);
  if (cookie) setOwnerCookie(cookie);
}

type Call = { url: string; method: string };

function recordFetch(handler: (url: string, method: string) => Promise<Response> | Response) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url, method });
    return Promise.resolve(handler(url, method));
  }));
  return calls;
}

const writesOf = (calls: Call[]) => calls.filter((call) => call.method !== "GET" && call.method !== "HEAD");
const lockPuts = (calls: Call[]) => calls.filter((call) => call.url.endsWith("/api/scout-approach-lock") && call.method === "PUT");
const settle = (ms = 50) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

test("provisional desk paints from the matching cache synchronously and only issues GETs until boot resolves", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  const calls = recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: true, empty: true })));
  render(<App />);
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Threads" })).toBeTruthy();
  await settle();
  expect(writesOf(calls)).toEqual([]);
  expect(calls.some((call) => call.url.includes("autoStart=1"))).toBe(false);
  expect(calls.some((call) => call.url.endsWith("/api/watch"))).toBe(false);
  expect(lockPuts(calls)).toEqual([]);
  await act(async () => { pending.resolve(Response.json(cachedDesk("Cached scout text"))); await pending.promise; });
});

test("boot returning a different user removes the first user's desk and cache", async () => {
  window.history.replaceState({}, "", "/dashboard");
  const other = { ...cachedUser, id: "other-owner", displayName: "Other Owner" };
  seedCache(cachedDesk("First owner secret text"));
  const pending = deferred<unknown>();
  recordFetch(async (url) => {
    if (!url.includes("/api/boot?")) return Response.json({ ok: true, empty: true });
    setOwnerCookie(OTHER_OWNER_HINT);
    return Response.json(await pending.promise);
  });
  render(<App />);
  expect(await screen.findByText("First owner secret text")).toBeTruthy();
  await act(async () => {
    pending.resolve(cachedDesk("Second owner text", other, OTHER_OWNER_HINT));
    await pending.promise;
  });
  await waitFor(() => expect(screen.getByText("Second owner text")).toBeTruthy());
  expect(screen.queryByText("First owner secret text")).toBeNull();
  flushDeskBootWrite();
  expect(localStorage.getItem(DESK_BOOT_KEY) ?? "").not.toContain("First owner secret text");
  expect(peekDeskBootCache(user.id)).toBeNull();
});

test("boot 401 while provisional shows the sign-in gate and empties the cache", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: true, empty: true })));
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
  await waitFor(() => expect(screen.queryByText("Cached scout text")).toBeNull());
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0);
  expect(localStorage.getItem(DESK_BOOT_KEY)).toBeNull();
  expect(peekDeskBootCache(user.id)).toBeNull();
});

test.each(["timeout", "error"])("boot %s while provisional keeps the cached desk, shows the offline notice, keeps the cache, and stays read-only", async (mode) => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const calls = recordFetch((url) => {
    if (mode === "error") return Promise.reject(new Error("offline"));
    return url.includes("/api/boot?") ? new Promise<Response>(() => {}) : Response.json({ ok: true, empty: true });
  });
  if (mode === "timeout") {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(24000); });
  } else {
    render(<App />);
    await screen.findByText("Showing your last desk — couldn't reach x-copilot. Reload to retry.");
  }
  expect(screen.getByText("Showing your last desk — couldn't reach x-copilot. Reload to retry.")).toBeTruthy();
  expect(screen.getByText("Cached scout text")).toBeTruthy();
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(screen.queryByRole("button", { name: /sign in/i })).toBeNull();
  expect(localStorage.getItem(DESK_BOOT_KEY)).toContain("Cached scout text");
  expect(peekDeskBootCache(user.id)?.user?.id).toBe(user.id);
  expect(writesOf(calls)).toEqual([]);
});

test("a cookie hint that differs from the cache hint paints only the boot screen", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"), OTHER_OWNER_HINT);
  const pending = deferred<Response>();
  recordFetch(() => pending.promise);
  render(<App />);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  await settle();
  expect(screen.queryByText("Cached scout text")).toBeNull();
  expect(screen.queryByText("Private Owner")).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
});

test("the approach lock is written exactly once, and only after the session verifies", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  const calls = recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: true, empty: true })));
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  await settle();
  expect(lockPuts(calls)).toEqual([]);
  await act(async () => { pending.resolve(Response.json(cachedDesk("Cached scout text"))); await pending.promise; });
  await waitFor(() => expect(lockPuts(calls)).toHaveLength(1));
  await settle(100);
  expect(lockPuts(calls)).toHaveLength(1);
  expect(screen.getByText("Cached scout text")).toBeTruthy();
});

test("a cross-tab session reset during the provisional phase invalidates the desk and the cache", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: true, empty: true })));
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: SESSION_RESET_KEY, newValue: "another-tab" })); });
  await waitFor(() => expect(screen.queryByText("Cached scout text")).toBeNull());
  expect(screen.getByText("Your session changed in another tab. Sign in again to continue.")).toBeTruthy();
  expect(localStorage.getItem(DESK_BOOT_KEY)).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
});

test("a changed owner cookie on focus during the provisional phase invalidates the desk and the cache", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: true, empty: true })));
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  act(() => {
    setOwnerCookie(OTHER_OWNER_HINT);
    window.dispatchEvent(new Event("focus"));
  });
  await waitFor(() => expect(screen.queryByText("Cached scout text")).toBeNull());
  expect(screen.getByText("Your session changed. Reload to continue.")).toBeTruthy();
  expect(localStorage.getItem(DESK_BOOT_KEY)).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
});

test("a provisional session on a non-dashboard path paints only the boot screen", async () => {
  window.history.replaceState({}, "", "/settings");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  recordFetch(() => pending.promise);
  render(<App />);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  expect(screen.queryByText("Cached scout text")).toBeNull();
  expect(screen.queryByText("Private Owner")).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
});

test("a provisional desk that fails boot after navigating away shows the cached view and notice", async () => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<Response>();
  recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: false }, { status: 503 })));
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  const interaction = userEvent.setup();
  await interaction.click(screen.getByRole("button", { name: /menu/i }));
  await interaction.click(await screen.findByRole("button", { name: /^settings$/i }));
  expect(await screen.findByText("Checking your session…")).toBeTruthy();
  await act(async () => {
    pending.reject(new Error("offline"));
    await pending.promise.catch(() => undefined);
  });
  await waitFor(() => {
    expect(screen.queryByText("Checking your session…")).toBeNull();
    expect(screen.getByText(/Showing your last desk/)).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings" })).toBeTruthy();
  });
});

test.each(["logout", "storage reset"])("a boot that resolves with a user after %s is dropped without writing the cache or painting", async (mode) => {
  window.history.replaceState({}, "", "/dashboard");
  seedCache(cachedDesk("Cached scout text"));
  const pending = deferred<unknown>();
  const calls = recordFetch(async (url) => {
    if (url.includes("/api/boot?")) return Response.json(await pending.promise);
    return Response.json({ ok: true, signedOut: true });
  });
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  if (mode === "logout") {
    const interaction = userEvent.setup();
    await interaction.click(screen.getByRole("button", { name: /menu/i }));
    await interaction.click(await screen.findByRole("button", { name: /sign out|log out/i }));
  } else {
    act(() => { window.dispatchEvent(new StorageEvent("storage", { key: SESSION_RESET_KEY, newValue: "another-tab" })); });
  }
  await waitFor(() => expect(screen.queryByText("Cached scout text")).toBeNull());
  expect(localStorage.getItem(DESK_BOOT_KEY)).toBeNull();
  await act(async () => {
    pending.resolve(cachedDesk("Late boot text"));
    await pending.promise;
  });
  await settle(100);
  flushDeskBootWrite();
  expect(localStorage.getItem(DESK_BOOT_KEY)).toBeNull();
  expect(peekDeskBootCache(user.id)).toBeNull();
  expect(screen.queryByText("Late boot text")).toBeNull();
  expect(screen.queryByText("Cached scout text")).toBeNull();
  expect(writesOf(calls).every((call) => call.url.endsWith("/api/auth/logout"))).toBe(true);
});

test("the provisional phase does not migrate an unscoped onboarding draft under the unverified id", async () => {
  window.history.replaceState({}, "", "/dashboard");
  const noAgenda = { ...cachedUser, agenda: null };
  seedCache(cachedDesk("Cached scout text", noAgenda));
  localStorage.setItem("xc-onboarding-agenda", "Unscoped onboarding draft");
  const pending = deferred<Response>();
  recordFetch((url) => (url.includes("/api/boot?") ? pending.promise : Response.json({ ok: true, empty: true })));
  render(<App />);
  expect(await screen.findByText("Cached scout text")).toBeTruthy();
  expect(localStorage.getItem("xc-onboarding-agenda")).toBe("Unscoped onboarding draft");
  expect(localStorage.getItem(`xc-onboarding-agenda:${user.id}`)).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
});
