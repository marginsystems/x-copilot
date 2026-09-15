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
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  const first = render(<App />);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  expect(screen.queryByText("Private Owner")).toBeNull();
  expect(screen.queryByText("Private agenda")).toBeNull();
  await act(async () => { pending.resolve(Response.json({ ok: false }, { status: 401 })); await pending.promise; });
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(peekDeskBootCache(user.id)).toBeNull();
  first.unmount();
  const reload = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => reload.promise));
  render(<App />);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  expect(screen.queryByText("Private Owner")).toBeNull();
  await act(async () => { reload.resolve(Response.json({ ok: false }, { status: 401 })); await reload.promise; });
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
