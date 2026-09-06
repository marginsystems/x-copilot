import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  normalizeTcoKey as spaNormalizeTcoKey,
  stripMediaShortlinksFromText as spaStripMediaShortlinksFromText,
} from "../../src/lib/mediaText.ts";
import { NEXT_ACTION_KINDS as spaNextActionKinds } from "../../src/lib/coaching.ts";
import { emptyDeskBeats as spaEmptyDeskBeats } from "../../src/lib/deskPhase.ts";
import {
  normalizeTcoKey as apiNormalizeTcoKey,
  stripMediaShortlinksFromText as apiStripMediaShortlinksFromText,
} from "./mediaText.ts";
import { NEXT_ACTION_KINDS as apiNextActionKinds } from "./nextActionLlm.ts";
import { ANALYTICS_EVENT_NAMES as apiAnalyticsEventNames } from "./analyticsClient.ts";
import { ANALYTICS_EVENT_NAMES as sidecarAnalyticsEventNames } from "../../analytics/src/events.ts";
import { emptyDeskBeats as apiEmptyDeskBeats } from "./deskBeats.ts";

const require = createRequire(import.meta.url);
const ecosystem = require("../../ecosystem.config.example.cjs") as {
  apps: { name: string; env?: { XCOPILOT_ROLE?: string } }[];
};

describe("mirrored SPA/API constants", () => {
  it("keeps mediaText equal on both sides", () => {
    assert.equal(spaNormalizeTcoKey.toString(), apiNormalizeTcoKey.toString());
    assert.equal(
      spaStripMediaShortlinksFromText.toString(),
      apiStripMediaShortlinksFromText.toString(),
    );
  });

  it("keeps NEXT_ACTION_KINDS equal on both sides", () => {
    assert.deepEqual(spaNextActionKinds, apiNextActionKinds);
  });

  it("keeps analytics event names equal on both sides", () => {
    assert.deepEqual(apiAnalyticsEventNames, sidecarAnalyticsEventNames);
  });

  it("keeps empty DeskBeats equal on both sides", () => {
    assert.deepEqual(spaEmptyDeskBeats(), apiEmptyDeskBeats());
  });

  it("keeps PM2 roles aligned with sidecar role gates", () => {
    assert.deepEqual(
      ecosystem.apps.map(({ name, env }) => [name, env?.XCOPILOT_ROLE]),
      [
        ["x-copilot-api", "api"],
        ["x-copilot-stats", "stats"],
        ["x-copilot-analytics", "analytics"],
        ["x-copilot-webhook", "webhook"],
      ],
    );
  });
});
