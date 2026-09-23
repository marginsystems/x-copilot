/// <reference path="../../src/vite-env.d.ts" />
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import App from "../../src/App";
import { parseDeskBoot, writeDeskBootCache } from "../../src/lib/deskBoot";
import { PRICING_TITLE } from "../../src/lib/seo";
import { deferred } from "./support/deferred";

vi.mock("../../src/lib/apiBase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/apiBase")>(),
  isLocalHostname: () => false,
}));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })));
});

afterEach(() => {
  window.history.replaceState({}, "", "/");
});

test("a public deep link paints anonymously while boot is stalled", async () => {
  window.history.replaceState({}, "", "/pricing");
  writeDeskBootCache(parseDeskBoot({
    ok: true,
    user: {
      id: "cached-owner",
      displayName: "Cached Owner",
      onboardingCompleted: true,
    },
    desk: {},
  })!);
  const pending = deferred<Response>();
  const fetchMock = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetchMock);

  render(<App />);

  expect(await screen.findByRole("heading", { name: "Plans" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in to start Free" })).toBeTruthy();
  expect(screen.queryByText("Usage & Billing")).toBeNull();
  expect(screen.queryByText("Cached Owner")).toBeNull();
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(document.title).toBe(PRICING_TITLE);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("route changes and browser history preserve public boot independence", async () => {
  window.history.replaceState({}, "", "/pricing");
  const pending = deferred<Response>();
  const fetchMock = vi.fn(() => pending.promise);
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Plans" })).toBeTruthy();
  act(() => {
    window.history.pushState({}, "", "/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByText("Checking your session…")).toBeTruthy();

  act(() => window.history.back());
  await waitFor(() => {
    expect(window.location.pathname).toBe("/pricing");
    expect(screen.getByRole("heading", { name: "Plans" })).toBeTruthy();
  });

  act(() => window.history.forward());
  await waitFor(() => {
    expect(window.location.pathname).toBe("/dashboard");
    expect(screen.getByText("Checking your session…")).toBeTruthy();
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("failed auth leaves the public route painted and protected routes gated", async () => {
  window.history.replaceState({}, "", "/pricing");
  const fetchMock = vi.fn(async () => Response.json(
    { ok: false, error: "unauthenticated", authRequired: true },
    { status: 401 },
  ));
  vi.stubGlobal("fetch", fetchMock);
  render(<App />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(await screen.findByRole("heading", { name: "Plans" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Sign in to start Free" })).toBeTruthy();

  act(() => {
    window.history.pushState({}, "", "/dashboard");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.queryByRole("heading", { name: "Plans" })).toBeNull();
  expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
});

test.each([
  "/privacy", "/terms", "/changelog", "/learn",
  "/learn/what-a-like-is-worth", "/learn/posts-that-get-a-reply",
  "/learn/how-many-replies", "/learn/likes-and-follows-you-give", "/learn/follow",
])("public chunk %s paints without waiting for auth", async (path) => {
  window.history.replaceState({}, "", path);
  const pending = deferred<Response>();
  vi.stubGlobal("fetch", vi.fn(() => pending.promise));
  render(<App />);
  await waitFor(() => {
    expect(document.querySelector("main h1, main h2")).not.toBeNull();
  });
  expect(screen.queryByText("Checking your session…")).toBeNull();
  expect(screen.queryByText("Loading page…")).toBeNull();
});
