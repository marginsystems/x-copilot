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
import {
  APPROACH_SUGGESTION_TEXT_MAX as sharedSuggestionTextMax,
  approachSuggestionCard as sharedSuggestionCard,
  parseDeskApproachState as sharedParseDeskApproachState,
  SCOUT_APPROACH_LOCK_PATH as sharedScoutApproachLockPath,
} from "../../../shared/src/scoutApproachLock.ts";
import { FOR_YOU_KINDS as sharedForYouKinds, X_COMPOSE_URL as sharedComposeUrl } from "../../../shared/src/forYou.ts";
import { suggestionPostedEvent as sharedSuggestionPostedEvent } from "../../../shared/src/approachNext.ts";
import {
  APPROACH_SUGGESTION_KINDS as apiSuggestionKinds,
  APPROACH_SUGGESTION_TEXT_MAX as apiSuggestionTextMax,
  deskStateFromBody as apiParseDeskApproachState,
  SCOUT_APPROACH_LOCK_PATH as apiScoutApproachLockPath,
} from "../scout/scoutApproachLock.ts";
import {
  APPROACH_NEXT_ACTIONS as sharedApproachNextActions,
  APPROACH_NEXT_ID_MAX as sharedApproachNextIdMax,
  APPROACH_NEXT_PATH as sharedApproachNextPath,
  parseApproachNextRequest as sharedParseApproachNextRequest,
} from "../../../shared/src/approachNext.ts";
import {
  APPROACH_NEXT_ACTIONS as apiApproachNextActions,
  APPROACH_NEXT_ID_MAX as apiApproachNextIdMax,
  APPROACH_NEXT_PATH as apiApproachNextPath,
} from "../desk/approachNextHttp.ts";
import {
  parseServerNextRequest as apiParseApproachNextRequest,
  serverSuggestionCard as apiSuggestionCard,
  serverSuggestionPostedEvent as apiSuggestionPostedEvent,
  X_COMPOSE_URL as apiComposeUrl,
} from "../desk/approachServerNext.ts";
import { OWN_POST_SEEN_PATH as apiOwnPostSeenPath } from "../desk/ownPostSeen.ts";
import { OWN_POST_SEEN_PATH as sharedOwnPostSeenPath } from "../../../shared/src/extensionBridge.ts";

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

  await it("keeps the extension's seen-post path equal on both sides", () => {
    assert.equal(sharedOwnPostSeenPath, apiOwnPostSeenPath);
  });

  await it("keeps the approach Next path, id limit, actions and request parsing equal on both sides", () => {
    assert.equal(sharedApproachNextPath, apiApproachNextPath);
    assert.equal(sharedApproachNextIdMax, apiApproachNextIdMax);
    assert.deepEqual([...sharedApproachNextActions], [...apiApproachNextActions]);
    for (const raw of [
      { fromCardId: " c1 " },
      { fromCardId: "c1", action: "next" },
      { fromCardId: "c1", action: "skip", kind: "scout" },
      { fromCardId: "c1", action: "dismiss", kind: "suggestion" },
      { fromCardId: "s1", action: "posted", kind: "suggestion" },
      { fromCardId: "c1", action: "posted", kind: "scout" },
      { fromCardId: "s1", action: "posted" },
      { fromCardId: "c1", action: "mark" },
      { forYou: true },
      { forYou: true, action: "skip" },
      { fromCardId: "c1", forYou: true },
      { fromCardId: "x".repeat(sharedApproachNextIdMax + 1), action: "skip" },
      null,
    ]) {
      assert.deepEqual(sharedParseApproachNextRequest(raw), apiParseApproachNextRequest(raw));
    }
  });

  await it("keeps the published suggested card and its desk state equal on both sides", () => {
    assert.deepEqual([...sharedForYouKinds], [...apiSuggestionKinds]);
    assert.equal(sharedSuggestionTextMax, apiSuggestionTextMax);
    assert.equal(sharedComposeUrl, apiComposeUrl);
    const rows = [
      { id: "s1", kind: "post" as const, why: "Take a side", targetId: null, targetUrl: null, targetAuthor: null },
      { id: "s2", kind: "reply" as const, why: "Join in", targetId: null, targetUrl: "https://x.com/e/status/900", targetAuthor: "@e" },
      { id: "s3", kind: "reply" as const, why: "Join in", targetId: "901", targetUrl: null, targetAuthor: null },
      { id: "s4", kind: "reply" as const, why: "Join in", targetId: null, targetUrl: null, targetAuthor: null },
      { id: "s5", kind: "quote" as const, why: "Quote it", targetId: "902", targetUrl: null, targetAuthor: "@q" },
      { id: "s6", kind: "repost" as const, why: "Repost it", targetId: "abc", targetUrl: "ftp://nope", targetAuthor: null },
      { id: "s7", kind: "post" as const, why: "w".repeat(sharedSuggestionTextMax + 5), targetId: null, targetUrl: null, targetAuthor: null },
    ];
    for (const row of rows) {
      assert.deepEqual(sharedSuggestionCard(row), apiSuggestionCard(row));
      assert.deepEqual(sharedSuggestionPostedEvent(row), apiSuggestionPostedEvent(row));
    }
    for (const raw of [
      { view: "suggestion", detected: false, suggestion: sharedSuggestionCard(rows[0]!) },
      { view: "suggestion", detected: true, suggestion: { ...sharedSuggestionCard(rows[1]!), why: "  padded  " } },
      { view: "suggestion", detected: false, suggestion: { id: "s1", kind: "thread", why: "x" } },
      { view: "suggestion", detected: false, suggestion: { id: "", kind: "post", why: "x" } },
      { view: "suggestion", detected: false },
      { view: "scout", detected: false, suggestion: sharedSuggestionCard(rows[0]!) },
      { view: "nope", detected: false },
      null,
    ]) {
      assert.deepEqual(sharedParseDeskApproachState(raw), apiParseDeskApproachState(raw));
    }
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
