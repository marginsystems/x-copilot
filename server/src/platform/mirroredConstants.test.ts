import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expectRecord, expectRecords } from "../http/http.testHelpers.ts";
import { createRequire } from "node:module";
import {
  normalizeTcoKey as spaNormalizeTcoKey,
  stripMediaShortlinksFromText as spaStripMediaShortlinksFromText,
} from "../../../frontend/src/lib/mediaText.ts";
import { NEXT_ACTION_KINDS as spaNextActionKinds } from "../../../shared/src/coaching.ts";
import { AGENDA_MIN_CHARS as spaAgendaMinChars } from "../../../frontend/src/lib/agendaPersist.ts";
import { AGENDA_MIN_CHARS as apiApproachAgendaMinChars } from "../desk/approachStock.ts";
import {
  APPROACH_SURFACES as sharedApproachSurfaces,
  DESK_PHASES as sharedDeskPhases,
  emptyDeskBeats as spaEmptyDeskBeats,
} from "../../../shared/src/deskPhase.ts";
import { APPROACH_SURFACES as apiApproachSurfaces, DESK_PHASES as apiDeskPhases } from "../desk/approachTaskStore.ts";
import {
  normalizeTcoKey as apiNormalizeTcoKey,
  stripMediaShortlinksFromText as apiStripMediaShortlinksFromText,
} from "../x-api/mediaText.ts";
import { NEXT_ACTION_KINDS as apiNextActionKinds } from "../desk/nextActionLlm.ts";
import { ANALYTICS_EVENT_NAMES as apiAnalyticsEventNames } from "../desk/analyticsClient.ts";
import { ANALYTICS_EVENT_NAMES as sidecarAnalyticsEventNames } from "../../../analytics/src/events.ts";
import { emptyDeskBeats as apiEmptyDeskBeats } from "../desk/deskBeats.ts";
import { EXTENSION_SESSION_PATH as apiExtensionSessionPath } from "../auth/extensionSessionHttp.ts";
import { EXTENSION_SESSION_PATH as sharedExtensionSessionPath } from "../../../shared/src/extensionBridge.ts";
import { SCOUT_APPROACH_LOCK_PATH as sharedScoutApproachLockPath } from "../../../shared/src/scoutApproachLock.ts";
import { SCOUT_APPROACH_LOCK_PATH as apiScoutApproachLockPath } from "../scout/scoutApproachLock.ts";
import { APPROACH_NEXT_ID_MAX as sharedApproachNextIdMax, APPROACH_NEXT_PATH as sharedApproachNextPath } from "../../../shared/src/approachNext.ts";
import { APPROACH_NEXT_ID_MAX as apiApproachNextIdMax, APPROACH_NEXT_PATH as apiApproachNextPath } from "../desk/approachNextHttp.ts";

const require = createRequire(import.meta.url);
const ecosystem = expectRecord(require("../../../ecosystem.config.example.cjs"));

await describe("mirrored SPA/API constants", async () => {
  await it("keeps mediaText equal on both sides", () => {
    assert.equal(spaNormalizeTcoKey.toString(), apiNormalizeTcoKey.toString());
    assert.equal(
      spaStripMediaShortlinksFromText.toString(),
      apiStripMediaShortlinksFromText.toString(),
    );
  });

  await it("keeps the extension pairing path equal on both sides", () => {
    assert.equal(sharedExtensionSessionPath, apiExtensionSessionPath);
  });

  await it("keeps the scout approach lock path equal on both sides", () => {
    assert.equal(sharedScoutApproachLockPath, apiScoutApproachLockPath);
  });

  await it("keeps the approach Next path and id limit equal on both sides", () => {
    assert.equal(sharedApproachNextPath, apiApproachNextPath);
    assert.equal(sharedApproachNextIdMax, apiApproachNextIdMax);
  });

  await it("keeps the approach lock phases and surfaces equal on both sides", () => {
    assert.deepEqual(sharedDeskPhases, apiDeskPhases);
    assert.deepEqual(sharedApproachSurfaces, apiApproachSurfaces);
  });

  await it("keeps the agenda length that lifts the Approach gate equal on both sides", () => {
    assert.equal(spaAgendaMinChars, apiApproachAgendaMinChars);
  });

  await it("keeps NEXT_ACTION_KINDS equal on both sides", () => {
    assert.deepEqual(spaNextActionKinds, apiNextActionKinds);
  });

  await it("keeps analytics event names equal on both sides", () => {
    assert.deepEqual(apiAnalyticsEventNames, sidecarAnalyticsEventNames);
  });

  await it("keeps empty DeskBeats equal on both sides", () => {
    assert.deepEqual(spaEmptyDeskBeats(), apiEmptyDeskBeats());
  });

  await it("keeps PM2 roles aligned with sidecar role gates", () => {
    assert.deepEqual(
      expectRecords(ecosystem.apps).map(({ name, env }) => [name, expectRecord(env).XCOPILOT_ROLE]),
      [
        ["x-copilot-api", "api"],
        ["x-copilot-stats", "stats"],
        ["x-copilot-analytics", "analytics"],
        ["x-copilot-webhook", "webhook"],
      ],
    );
  });
});
