import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { testRequest, testResponse, expectRecord } from "../http/http.testHelpers.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { getWatchedThread } from "../desk/ownPostStore.ts";
import { saveScoutCache, pruneThreadsFromScoutCache } from "../scout/scoutCache.ts";
import { readRetainedTargetContext } from "../scout/scoutEvidenceContext.ts";
import { tryHandleXActivityAuthed } from "./xActivityHttp.ts";

function signIn(tag: string): { userId: string; cookie: string } {
  const user = upsertOauthUser({
    provider: "google",
    providerUserId: `gid-${tag}`,
    email: `${tag}@example.com`,
    emailVerified: true,
  });
  const { token } = createSession(user.id);
  return {
    userId: user.id,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
  };
}

async function call(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = testRequest();
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res, captured } = testResponse(req);
  const handledPromise = tryHandleXActivityAuthed(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    req.emit("data", Buffer.from(JSON.stringify(body)));
  }
  req.emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status: captured.status,
    json: captured.raw ? expectRecord(JSON.parse(captured.raw)) : {},
  };
}

await describe("POST /api/watch", async () => {
  let temp: TempPlatformDb;
  let a: { userId: string; cookie: string };
  let b: { userId: string; cookie: string };

  beforeEach(() => {
    temp = openTempPlatformDb("x-activity-http-");
    a = signIn("a");
    b = signIn("b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("requires a session and a thread id", async () => {
    assert.equal((await call("POST", "/api/watch", { threadId: "t" })).status, 401);
    const empty = await call("POST", "/api/watch", { threads: [{}] }, a.cookie);
    assert.equal(empty.status, 400);
    assert.equal(empty.json.error, "thread_id_required");
    assert.equal((await call("GET", "/api/nope")).handled, false);
  });

  await it("watches threads and retains the tank card's kind, not the body's", async () => {
    await saveScoutCache(
      {
        savedAt: "2026-09-20T00:00:00.000Z",
        queries: [],
        threads: [
          {
            id: "c1",
            author: "@alice",
            text: "Housing supply debate",
            url: "https://x.com/alice/status/c1",
            threadKind: "sharp_opinion",
            conversationId: "root1",
          },
        ],
      },
      { userId: a.userId },
    );
    const watched = await call(
      "POST",
      "/api/watch",
      {
        threads: [
          { threadId: "c1", author: "@spoofed", threadKind: "bare_news" },
          { threadId: "organic", author: "@bob", text: "Chip export controls" },
        ],
      },
      a.cookie,
    );
    assert.equal(watched.status, 200);
    assert.equal(watched.json.watched, 2);
    assert.equal(getWatchedThread(a.userId, "c1")?.author, "@spoofed");

    const c1 = readRetainedTargetContext(a.userId, "c1");
    assert.equal(c1?.threadKind, "sharp_opinion");
    assert.equal(c1?.author, "alice");
    assert.deepEqual(c1?.topics, ["housing", "supply", "debate"]);
    const organic = readRetainedTargetContext(a.userId, "organic");
    assert.equal(organic?.threadKind, null);
    assert.equal(organic?.author, "bob");
    assert.equal(organic?.contextSource, "watch");
    assert.equal(readRetainedTargetContext(b.userId, "c1"), null);

    // Context outlives the card's removal from the tank.
    await pruneThreadsFromScoutCache(["c1"], { userId: a.userId });
    assert.equal(readRetainedTargetContext(a.userId, "c1")?.threadKind, "sharp_opinion");
  });
});
