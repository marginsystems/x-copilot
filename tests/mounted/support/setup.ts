import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // Mounted tests must explicitly supply their network fixtures.
  vi.stubGlobal("fetch", vi.fn(() => {
    throw new Error("Unexpected fetch: install a test fixture before mounting");
  }));
});

afterEach(() => {
  // Unmount while clocks and globals still belong to the test so effect
  // cleanup can cancel its own work. Always restore, even after a failure.
  try {
    cleanup();
  } finally {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  }
});
