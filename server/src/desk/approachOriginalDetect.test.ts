import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { createSession } from "../auth/sessionStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { insertSuggestions } from "../for-you/forYouStore.ts";
import { testRequest } from "../http/http.testHelpers.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import {
  getDeskApproachState,
  keepDetectedOriginal,
  setDeskApproachState,
  type DeskApproachState,
} from "../scout/scoutApproachLock.ts";
import {
  SCOUT_APPROACH_LOCK_EVENTS_PATH,
  resetScoutApproachLockEventsForTests,
  tryHandleScoutApproachLockEvents,
} from "../scout/scoutApproachLockEvents.ts";
import { detectOriginalForApproach, waitingOriginalCard } from "./approachOriginalDetect.ts";
import { serverSuggestionCard } from "./approachServerNext.ts";
import { setApproachTask } from "./approachTaskStore.ts";
import { resetDeskEventsForTests, tryHandleDeskEventsWake } from "./deskEvents.ts";
import { seenOriginalNeedsKind } from "./ownPostSeen.ts";

const CARD_AT_MS = Date.parse("2026-10-07T12:00:00.000Z");
const AFTER = new Date(CARD_AT_MS + 60_000).toISOString();
const BEFORE = new Date(CARD_AT_MS - 60_000).toISOString();

function mockRes() {
  const chunks: string[] = [];
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead() {
      return res;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
      return res;
    },
    once() {
      return res;
    },
  });
  return { res, frames: () => chunks.join("") };
}

function watchLock(token: string) {
  const req = Object.assign(testRequest(), { method: "GET", headers: { authorization: `Bearer ${token}` } });
  const mock = mockRes();
  tryHandleScoutApproachLockEvents(req, mock.res, new URL(`http://localhost${SCOUT_APPROACH_LOCK_EVENTS_PATH}`));
  return () => mock.frames().split("event: lock_changed").length - 1;
}

async function wake(body: unknown): Promise<void> {
  const req = Object.assign(testRequest(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer original-detect-secret" },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res } = mockRes();
  const pending = tryHandleDeskEventsWake(req, res, new URL("http://localhost/api/desk/events/wake"));
  req.emit("data", Buffer.from(JSON.stringify(body)));
  req.emit("end");
  assert.equal(await pending, true);
}

function post(id: string, kind: string, postedAt: string) {
  return { id, kind, postedAt, url: `https://x.com/pilot/status/${id}` };
}

await describe("original post detection for the Approach card", async () => {
  let temp: TempPlatformDb;
  let userId: string;
  let token: string;
  let ogId: string;
  const savedSecret = process.env.DESK_EVENTS_SECRET;

  beforeEach(() => {
    temp = openTempPlatformDb("x-approach-original-");
    process.env.DESK_EVENTS_SECRET = "original-detect-secret";
    resetDeskEventsForTests();
    resetScoutApproachLockEventsForTests();
    userId = upsertOauthUser({
      provider: "google",
      providerUserId: "og-detect",
      email: "og-detect@example.com",
      emailVerified: true,
    }).id;
    token = createSession(userId, undefined, "extension").token;
    const [og] = insertSuggestions({
      userId,
      tenantId: ensureUserTenant(userId),
      actions: [{ kind: "post", why: "Take a side" }],
    });
    assert.ok(og);
    ogId = og.id;
    setApproachTask(userId, { phase: "organic_reply", cardId: ogId, surface: null }, "desk", CARD_AT_MS);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
    resetDeskEventsForTests();
    resetScoutApproachLockEventsForTests();
    if (savedSecret === undefined) delete process.env.DESK_EVENTS_SECRET;
    else process.env.DESK_EVENTS_SECRET = savedSecret;
  });

  await it("marks the waiting original post card detected with the post, and tells the panel at once, with no desk open", () => {
    const changes = watchLock(token);
    assert.equal(detectOriginalForApproach(userId, post("1900000001", "original", AFTER)), true);

    const state = getDeskApproachState(userId);
    assert.equal(state?.view, "suggestion");
    assert.equal(state?.detected, true);
    assert.equal(state?.suggestion?.id, ogId);
    assert.deepEqual(state?.post, { id: "1900000001", url: "https://x.com/pilot/status/1900000001" });
    assert.equal(changes(), 1);
    assert.equal(waitingOriginalCard(userId), null);
    assert.equal(detectOriginalForApproach(userId, post("1900000002", "original", AFTER)), false);
    assert.equal(changes(), 1);
  });

  await it("ignores replies, quotes and originals posted before the card became current", () => {
    const changes = watchLock(token);
    assert.equal(detectOriginalForApproach(userId, post("1900000003", "reply", AFTER)), false);
    assert.equal(detectOriginalForApproach(userId, post("1900000004", "quote", AFTER)), false);
    assert.equal(detectOriginalForApproach(userId, post("1900000005", "original", BEFORE)), false);
    assert.equal(getDeskApproachState(userId)?.detected ?? false, false);
    assert.equal(changes(), 0);
  });

  await it("does nothing when the card is not an original post", () => {
    const [reply] = insertSuggestions({
      userId,
      tenantId: ensureUserTenant(userId),
      actions: [{ kind: "reply", why: "Join in", targetId: "900", targetUrl: "https://x.com/erin/status/900" }],
    });
    assert.ok(reply);
    setApproachTask(userId, { phase: "organic_reply", cardId: reply.id, surface: null }, "desk", CARD_AT_MS);
    assert.equal(detectOriginalForApproach(userId, post("1900000006", "original", AFTER)), false);
    setApproachTask(userId, { phase: "scout_reply", cardId: "a1", surface: null }, "desk", CARD_AT_MS);
    assert.equal(detectOriginalForApproach(userId, post("1900000007", "original", AFTER)), false);
  });

  await it("detects from X's confirmed kind on the webhook wake, not from a reply the wake confirms", async () => {
    await wake({ userId, id: "1900000008", kind: "reply", postedAt: AFTER, url: "https://x.com/pilot/status/1900000008", text: "" });
    assert.equal(getDeskApproachState(userId)?.detected ?? false, false);
    await wake({ userId, id: "1900000009", kind: "original", postedAt: AFTER, url: "https://x.com/pilot/status/1900000009", text: "" });
    assert.equal(getDeskApproachState(userId)?.detected, true);
    assert.equal(getDeskApproachState(userId)?.post?.id, "1900000009");
  });

  await it("asks X for the kind only for a seen post off a status page while an original post card waits", () => {
    const seen = { postId: "1900000010", url: "https://x.com/pilot/status/1900000010", pageStatusId: null };
    assert.equal(seenOriginalNeedsKind(userId, seen, "provisional"), true);
    assert.equal(seenOriginalNeedsKind(userId, { ...seen, pageStatusId: "77" }, "provisional"), false);
    assert.equal(seenOriginalNeedsKind(userId, seen, "confirmed"), false);
    detectOriginalForApproach(userId, post("1900000011", "original", AFTER));
    assert.equal(seenOriginalNeedsKind(userId, seen, "provisional"), false);
  });

  await it("keeps the server's detection when the desk publishes the same card undetected", () => {
    detectOriginalForApproach(userId, post("1900000012", "original", AFTER));
    const stored = getDeskApproachState(userId);
    const [og] = insertSuggestions({ userId, tenantId: ensureUserTenant(userId), actions: [{ kind: "post", why: "Another" }] });
    assert.ok(og);
    const suggestion = stored?.suggestion;
    assert.ok(suggestion);
    const undetected: DeskApproachState = { view: "suggestion", detected: false, suggestion };
    assert.deepEqual(keepDetectedOriginal(stored, undetected), stored);
    const other: DeskApproachState = { view: "suggestion", detected: false, suggestion: serverSuggestionCard(og) };
    assert.deepEqual(keepDetectedOriginal(stored, other), other);
    setDeskApproachState(userId, null);
    assert.deepEqual(keepDetectedOriginal(null, undetected), undetected);
  });
});
