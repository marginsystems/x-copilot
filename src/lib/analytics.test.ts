import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GA_MEASUREMENT_ID,
  gaMeasurementId,
  trackPageView,
} from "./analytics.ts";

describe("gaMeasurementId", () => {
  it("defaults to the xcopilot.dev stream", () => {
    assert.equal(gaMeasurementId(), DEFAULT_GA_MEASUREMENT_ID);
  });
});

describe("trackPageView", () => {
  it("no-ops when gtag is missing", () => {
    const prevWindow = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = {};
    try {
      trackPageView("/voice");
    } finally {
      (globalThis as unknown as { window: unknown }).window = prevWindow;
    }
  });

  it("emits a page_view for the SPA path after accept", () => {
    const calls: unknown[][] = [];
    const gtag = (...args: unknown[]) => calls.push(args);
    const prevWindow = globalThis.window;
    (globalThis as unknown as { window: unknown }).window = {
      gtag,
      location: { origin: "https://xcopilot.dev" },
    };
    try {
      trackPageView("/voice");
    } finally {
      (globalThis as unknown as { window: unknown }).window = prevWindow;
    }
    assert.deepEqual(calls, [
      [
        "event",
        "page_view",
        {
          page_path: "/voice",
          page_location: "https://xcopilot.dev/voice",
          send_to: DEFAULT_GA_MEASUREMENT_ID,
        },
      ],
    ]);
  });
});
