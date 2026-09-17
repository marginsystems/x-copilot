/// <reference path="../../src/vite-env.d.ts" />
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import App from "../../src/App";
import { parseDeskBoot, peekDeskBootCache, writeDeskBootCache } from "../../src/lib/deskBoot";
import { deferred } from "./support/deferred";

vi.mock("../../src/lib/apiBase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/apiBase")>(),
  isLocalHostname: () => false,
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { window.history.replaceState({}, "", "/"); });

const user = { id: "private-owner", displayName: "Private Owner", email: null, avatarUrl: null, agenda: "Private agenda", onboardingCompleted: true, xUsername: "private_handle", xLinked: true, xCanPost: true, isAdmin: false };
const boot = parseDeskBoot({ ok: true, user, desk: {} })!;

test("dashboard reload with cached identity paints only verification until server rejection", async () => {
  window.history.replaceState({}, "", "/dashboard");
  writeDeskBootCache(boot);
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
    user: { ...user, onboardingCompleted: false },
    desk: { lastScout: { ok: true, empty: true } },
  })!;
  const ready = parseDeskBoot({
    ok: true,
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
