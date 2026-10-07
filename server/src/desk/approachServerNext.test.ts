import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { completeOnboarding } from "../auth/authStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { insertSuggestions, markSuggestion } from "../for-you/forYouStore.ts";
import { expectRecord, testRequest } from "../http/http.testHelpers.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import {
  getDeskApproachState,
  getScoutApproachLock,
  getScoutApproachNext,
} from "../scout/scoutApproachLock.ts";
import { saveScoutCache } from "../scout/scoutCache.ts";
import { tryHandleApproachNext } from "./approachNextHttp.ts";
import {
  advanceApproachOnServer,
  parseServerNextRequest,
  publishedStateFor,
  serverNextApplies,
  serverNextEvent,
} from "./approachServerNext.ts";
import { listReleasedCardIds, releaseCardIds } from "./approachStock.ts";
import { getApproachTask, setApproachTask } from "./approachTaskStore.ts";

const AGENDA = "Building developer tools for people who ship small products every week.";
const FOR_YOU = { phase: "hold" as const, cardId: null, surface: "for_you" as const };

function thread(id: string, author: string) {
  return {
    id,
    author,
    text: `${author} shipped something`,
    url: `https://x.com/${author.slice(1)}/status/${id}`,
    createdAt: new Date().toISOString(),
    engage: "consider" as const,
    baitScore: 10,
    onAgenda: true,
  };
}

await describe("server approach Next", async () => {
  let temp: TempPlatformDb;
  let userId: string;
  let cookie: string;

  beforeEach(async () => {
    temp = openTempPlatformDb("x-approach-server-next-");
    userId = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-next",
      username: "pilot_next",
      emailVerified: false,
    }).id;
    completeOnboarding(userId, AGENDA);
    cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession(userId).token)}`;
    await saveScoutCache(
      {
        savedAt: new Date().toISOString(),
        agenda: AGENDA,
        queries: ["q"],
        threads: [thread("a1", "@alpha"), thread("a2", "@bravo")],
      },
      { userId },
    );
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("does nothing until a desk has published its lock", async () => {
    assert.equal(await advanceApproachOnServer(userId, { forYou: true }), false);
    assert.equal(getApproachTask(userId), null);
  });

  await it("moves from For You to the first Scout card and publishes it for the panel", async () => {
    setApproachTask(userId, FOR_YOU, "desk");
    assert.equal(await advanceApproachOnServer(userId, { forYou: true }), true);

    const task = getApproachTask(userId);
    assert.deepEqual(task?.lock, { phase: "scout_reply", cardId: "a1", surface: null });
    assert.equal(task?.owner, "server");
    assert.equal(getScoutApproachLock(userId)?.id, "a1");
    assert.equal(getScoutApproachLock(userId)?.author, "@alpha");
    assert.deepEqual(getDeskApproachState(userId), { view: "scout", detected: false });
    assert.deepEqual(getScoutApproachNext(userId), { card: null });
  });

  await it("moves past the Scout card it is on, replied or not, and releases it", async () => {
    setApproachTask(userId, { phase: "scout_reply", cardId: "a1", surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "other" }), false);
    assert.equal(getApproachTask(userId)?.owner, "desk");

    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a1" }), true);
    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "silent_refuel", cardId: null, surface: "for_you" });
    assert.equal(getScoutApproachLock(userId), null);
    assert.equal(getDeskApproachState(userId), null);
    assert.deepEqual(listReleasedCardIds(userId), ["a1"]);
    assert.equal(getScoutApproachNext(userId)?.card?.id, "a2");
  });

  await it("skips the Scout card it is on to the next Scout card, as the desk's Skip does, and releases it", async () => {
    setApproachTask(userId, { phase: "scout_reply", cardId: "a1", surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a1", action: "skip", kind: "scout" }), true);

    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "scout_reply", cardId: "a2", surface: null });
    assert.equal(getApproachTask(userId)?.owner, "server");
    assert.equal(getScoutApproachLock(userId)?.id, "a2");
    assert.equal(getScoutApproachLock(userId)?.author, "@bravo");
    assert.deepEqual(getDeskApproachState(userId), { view: "scout", detected: false });
    assert.deepEqual(listReleasedCardIds(userId), ["a1"]);
  });

  await it("dismisses the last Scout card into Collecting rather than For You", async () => {
    setApproachTask(userId, { phase: "scout_reply", cardId: "a2", surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a2", action: "dismiss", kind: "scout" }, Date.now()), true);
    assert.equal(getApproachTask(userId)?.lock.cardId, "a1");

    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a1", action: "dismiss", kind: "scout" }), true);
    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "scout_reply", cardId: null, surface: null });
    assert.equal(getScoutApproachLock(userId), null);
    assert.deepEqual(getDeskApproachState(userId), { view: "collecting", detected: false });
    assert.deepEqual(listReleasedCardIds(userId).sort(), ["a1", "a2"]);
  });

  await it("refuses a Skip or Not interested for a card the lock is not on", async () => {
    setApproachTask(userId, { phase: "scout_reply", cardId: "a1", surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a2", action: "skip", kind: "scout" }), false);
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a2", action: "dismiss", kind: "scout" }), false);
    assert.equal(getApproachTask(userId)?.owner, "desk");
    assert.deepEqual(listReleasedCardIds(userId), []);
  });

  await it("skips a suggested reply card by its suggestion id and moves on as the desk does", async () => {
    const [suggestion] = insertSuggestions({
      userId,
      tenantId: ensureUserTenant(userId),
      actions: [{ kind: "reply", why: "Join this thread", targetId: "900", targetUrl: "https://x.com/erin/status/900" }],
    });
    assert.ok(suggestion);
    const lock = { phase: "organic_reply" as const, cardId: suggestion.id, surface: null };
    setApproachTask(userId, lock, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: suggestion.id }), false);
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "900", action: "skip", kind: "suggestion" }), false);

    assert.equal(await advanceApproachOnServer(userId, { fromCardId: suggestion.id, action: "skip", kind: "suggestion" }), true);
    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "scout_reply", cardId: "a1", surface: null });
    assert.equal(getScoutApproachLock(userId)?.id, "a1");
    assert.deepEqual(listReleasedCardIds(userId), [suggestion.id]);
  });

  function suggest(actions: Parameters<typeof insertSuggestions>[0]["actions"]) {
    return insertSuggestions({ userId, tenantId: ensureUserTenant(userId), actions });
  }

  await it("publishes the suggested card it moves to, of any kind, with what the panel shows", async () => {
    const [quote] = suggest([{ kind: "quote", why: "Quote this launch", targetId: "777", targetAuthor: "@gina" }]);
    assert.ok(quote);
    setApproachTask(userId, { phase: "scout_reply", cardId: "a1", surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "a1" }), true);

    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "organic_reply", cardId: quote.id, surface: null });
    assert.equal(getScoutApproachLock(userId), null);
    assert.equal(getScoutApproachNext(userId), null);
    assert.deepEqual(getDeskApproachState(userId), {
      view: "suggestion",
      detected: false,
      suggestion: {
        id: quote.id,
        kind: "quote",
        why: "Quote this launch",
        targetId: "777",
        targetUrl: null,
        targetAuthor: "@gina",
        openUrl: "https://x.com/i/status/777",
      },
    });
  });

  await it("moves an original post on after I posted on X, as the desk does, and refuses another card", async () => {
    const [post] = suggest([{ kind: "post", why: "Take a side on AI wealth gains" }]);
    assert.ok(post);
    setApproachTask(userId, { phase: "organic_reply", cardId: post.id, surface: null }, "desk");
    markSuggestion({ id: post.id, userId, status: "done" });
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "other", action: "posted", kind: "suggestion" }), false);
    assert.equal(getApproachTask(userId)?.owner, "desk");

    assert.equal(await advanceApproachOnServer(userId, { fromCardId: post.id, action: "posted", kind: "suggestion" }), true);
    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "scout_reply", cardId: "a1", surface: null });
    assert.equal(getScoutApproachLock(userId)?.id, "a1");
    assert.deepEqual(listReleasedCardIds(userId), [post.id]);
  });

  await it("skips and dismisses an original post card by its suggestion id", async () => {
    const [first, second] = suggest([
      { kind: "post", why: "First original" },
      { kind: "post", why: "Second original" },
    ]);
    assert.ok(first && second);
    setApproachTask(userId, { phase: "organic_reply", cardId: first.id, surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: first.id, action: "skip", kind: "suggestion" }), true);
    assert.equal(getApproachTask(userId)?.lock.cardId, "a1");
    setApproachTask(userId, { phase: "organic_reply", cardId: second.id, surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: second.id, action: "dismiss", kind: "suggestion" }), true);
    assert.equal(getApproachTask(userId)?.lock.cardId, "a1");
  });

  await it("moves a detected suggested reply on with the desk's Next, which prefers another suggestion over For You", async () => {
    releaseCardIds(userId, ["a1", "a2"]);
    const [current, following] = suggest([
      { kind: "reply", why: "Join this thread", targetId: "900", targetUrl: "https://x.com/erin/status/900", targetAuthor: "@erin" },
      { kind: "reply", why: "Answer this one", targetId: "901", targetUrl: "https://x.com/finn/status/901", targetAuthor: "@finn" },
    ]);
    assert.ok(current && following);
    setApproachTask(userId, { phase: "organic_reply", cardId: current.id, surface: null }, "desk");
    markSuggestion({ id: current.id, userId, status: "done" });

    assert.equal(await advanceApproachOnServer(userId, { fromCardId: "900", action: "posted", kind: "suggestion" }), false);
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: current.id, action: "posted", kind: "suggestion" }), true);
    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "organic_reply", cardId: following.id, surface: null });
    assert.equal(getScoutApproachLock(userId)?.id, "901");
    assert.equal(getDeskApproachState(userId)?.suggestion?.id, following.id);
    assert.equal(getDeskApproachState(userId)?.suggestion?.openUrl, "https://x.com/finn/status/901");
  });

  await it("moves an original post on to For You after I posted on X when only another reply suggestion is left", async () => {
    releaseCardIds(userId, ["a1", "a2"]);
    const [post, reply] = suggest([
      { kind: "post", why: "Take a side" },
      { kind: "reply", why: "Answer this one", targetId: "901" },
    ]);
    assert.ok(post && reply);
    setApproachTask(userId, { phase: "organic_reply", cardId: post.id, surface: null }, "desk");
    markSuggestion({ id: post.id, userId, status: "done" });
    assert.equal(await advanceApproachOnServer(userId, { fromCardId: post.id, action: "posted", kind: "suggestion" }), true);
    assert.deepEqual(getApproachTask(userId)?.lock, { phase: "silent_refuel", cardId: null, surface: "for_you" });
  });

  await it("names the desk event for I posted on X by the suggested card's kind", () => {
    const posted = { fromCardId: "s1", action: "posted" as const, kind: "suggestion" as const };
    assert.deepEqual(serverNextEvent(posted, { kind: "reply", targetId: "900", targetUrl: null }), { type: "next" });
    assert.deepEqual(serverNextEvent(posted, { kind: "post", targetId: null, targetUrl: null }), { type: "posted" });
    assert.deepEqual(serverNextEvent(posted), { type: "posted" });
    assert.deepEqual(serverNextEvent({ fromCardId: "s1" }), { type: "next" });
  });

  await it("reads the action strictly and applies Skip or Not interested only to the locked Scout or suggested card", () => {
    assert.deepEqual(parseServerNextRequest({ fromCardId: " a1 ", action: "skip", kind: "scout" }), { fromCardId: "a1", action: "skip", kind: "scout" });
    assert.deepEqual(parseServerNextRequest({ fromCardId: "a1", action: "next" }), { fromCardId: "a1" });
    assert.equal(parseServerNextRequest({ fromCardId: "a1", action: "posted" }), null);
    assert.equal(parseServerNextRequest({ fromCardId: "a1", action: "posted", kind: "scout" }), null);
    assert.equal(parseServerNextRequest({ forYou: true, action: "dismiss" }), null);
    const scout = { phase: "scout_reply" as const, cardId: "a1", surface: null };
    const suggested = { phase: "organic_reply" as const, cardId: "s1", surface: null };
    assert.equal(serverNextApplies(scout, { fromCardId: "a1", action: "dismiss", kind: "scout" }), true);
    assert.equal(serverNextApplies(suggested, { fromCardId: "s1", action: "skip", kind: "suggestion" }), true);
    assert.equal(serverNextApplies(suggested, { fromCardId: "s1" }), false);
    assert.equal(serverNextApplies(FOR_YOU, { fromCardId: "a1", action: "skip", kind: "scout" }), false);
  });

  await it("ignores a For You Next when the lock is not on For You", async () => {
    setApproachTask(userId, { phase: "scout_reply", cardId: "a1", surface: null }, "desk");
    assert.equal(await advanceApproachOnServer(userId, { forYou: true }), false);
    assert.equal(getApproachTask(userId)?.owner, "desk");
  });

  await it("leaves For You detection to the panel and names the other views", () => {
    assert.equal(publishedStateFor(FOR_YOU), null);
    assert.deepEqual(publishedStateFor({ phase: "done_for_now", cardId: null, surface: null }), { view: "collecting", detected: false });
    assert.deepEqual(publishedStateFor({ phase: "organic_reply", cardId: "s1", surface: null }), { view: "suggestion", detected: false });
    assert.deepEqual(publishedStateFor({ phase: "silent_refuel", cardId: null, surface: "link_x" }), { view: "other", detected: false });
  });

  await it("answers advanced when no desk is listening and the server moved the card", async () => {
    setApproachTask(userId, FOR_YOU, "desk");
    const req = testRequest();
    Object.assign(req, { method: "POST", headers: { cookie }, socket: { remoteAddress: "127.0.0.1" } });
    let status = 0;
    let raw = "";
    const res = Object.assign(new ServerResponse(testRequest()), {
      writeHead: (code: number) => {
        status = code;
      },
      end: (chunk: string) => {
        raw = chunk;
      },
    });
    const handled = tryHandleApproachNext(req, res, new URL("http://localhost/api/desk/approach/next"));
    req.emit("data", Buffer.from(JSON.stringify({ forYou: true })));
    req.emit("end");
    assert.equal(await handled, true);
    assert.equal(status, 200);
    assert.deepEqual(expectRecord(JSON.parse(raw)), { ok: true, delivered: false, advanced: true });
    assert.equal(getApproachTask(userId)?.owner, "server");
  });
});
