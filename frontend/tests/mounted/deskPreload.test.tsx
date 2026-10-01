/// <reference path="../../src/vite-env.d.ts" />
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import "../../src/App";
import { deferred } from "./support/deferred";

const deskViewLoaded = { count: 0 };

vi.mock("../../src/lib/apiBase", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/lib/apiBase")>(),
  isLocalHostname: () => false,
}));

beforeEach(() => {
  deskViewLoaded.count = 0;
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});

afterEach(() => { window.history.replaceState({}, "", "/"); });

type AppModule = typeof import("../../src/App");

function isAppModule(module: unknown): module is AppModule {
  return typeof module === "object" && module !== null && "default" in module && typeof module.default === "function";
}

async function evaluateAppAt(path: string): Promise<AppModule> {
  const module: unknown = await import(`../../src/App?start=${encodeURIComponent(path)}`);
  if (!isAppModule(module)) throw new Error("App module has no default component");
  return module;
}

async function startApp(path: string) {
  window.history.replaceState({}, "", path);
  const boot = deferred<Response>();
  const fetchMock = vi.fn((_input: RequestInfo | URL) => boot.promise);
  vi.stubGlobal("fetch", fetchMock);
  vi.doMock("../../src/desk/DeskView", () => {
    deskViewLoaded.count += 1;
    return { default: () => <h1>Desk</h1> };
  });
  const { default: App } = await evaluateAppAt(path);
  await act(async () => { render(<App />); });
  return { fetchMock };
}

test.each(["/dashboard", "/play"])("app start on %s imports the desk chunk while boot is pending", async (path) => {
  const { fetchMock } = await startApp(path);
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([expect.stringContaining("/api/boot")]);
  expect(screen.getByText("Checking your session…")).toBeTruthy();
  expect(deskViewLoaded.count).toBe(1);
});

test.each(["/", "/pricing", "/account"])("app start on %s does not import the desk chunk", async (path) => {
  await startApp(path);
  expect(deskViewLoaded.count).toBe(0);
});
