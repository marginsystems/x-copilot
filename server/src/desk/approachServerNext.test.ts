import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { completeOnboarding } from "../auth/authStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
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
import { advanceApproachOnServer, publishedStateFor } from "./approachServerNext.ts";
import { listReleasedCardIds } from "./approachStock.ts";
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
