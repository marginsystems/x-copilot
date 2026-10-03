import { testRequest } from "../http/http.testHelpers.js";
import { expectRecord } from "../http/http.testHelpers.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { saveScoutCache } from "./scoutCache.ts";
import {
  getScoutApproachLock,
  getScoutApproachNext,
  setScoutApproachLock,
  setScoutApproachNext,
  tryHandleScoutApproachLock,
} from "./scoutApproachLock.ts";
import { readRetainedTargetContext } from "./scoutEvidenceContext.ts";

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
  body?: unknown,
  cookie?: string,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = testRequest();
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
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
  const handledPromise = tryHandleScoutApproachLock(
    req,
    res,
    new URL("http://localhost/api/scout-approach-lock"),
  );
  if (body !== undefined) {
    (req).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (expectRecord(JSON.parse(raw))) : {},
  };
}

await describe("scoutApproachLock", async () => {
  let temp: TempPlatformDb;
  let a: { userId: string; cookie: string };

  beforeEach(() => {
    temp = openTempPlatformDb("x-scout-lock-");
    a = signIn("a");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("rejects unauthenticated and malformed requests", async () => {
    assert.equal((await call("PUT", { card: { id: "c1" } })).status, 401);
    assert.equal((await call("GET")).status, 401);
    assert.equal((await call("DELETE", undefined, a.cookie)).status, 405);
    assert.equal((await call("PUT", { card: "x" }, a.cookie)).status, 400);
    assert.equal((await call("PUT", { card: { id: " " } }, a.cookie)).status, 400);
  });

  await it("retains server-side card context at lock time and keeps it after the lock clears", async () => {
    await saveScoutCache(
      {
        savedAt: "2026-09-20T00:00:00.000Z",
        queries: [],
        threads: [
          {
            id: "c1",
            author: "@alice",
            text: "Rates and inflation",
            url: "https://x.com/alice/status/c1",
            threadKind: "fact_add",
            conversationId: "root1",
          },
        ],
      },
      { userId: a.userId },
    );
    const locked = await call(
      "PUT",
      {
        card: {
          id: "c1",
          author: "@spoofed",
          threadKind: "bare_news",
          conversationId: "root1",
          surface: "reply",
        },
      },
      a.cookie,
    );
    assert.equal(locked.status, 200);
    assert.equal(getScoutApproachLock(a.userId)?.id, "c1");
    const retained = readRetainedTargetContext(a.userId, "c1");
    assert.equal(retained?.threadKind, "fact_add");
    assert.equal(retained?.author, "alice");
    assert.deepEqual(retained?.topics, ["rates", "inflation"]);

    const cleared = await call("PUT", { card: null }, a.cookie);
    assert.equal(cleared.status, 200);
    assert.equal(getScoutApproachLock(a.userId), null);
    assert.equal(readRetainedTargetContext(a.userId, "c1")?.threadKind, "fact_add");
  });

  await it("keeps an unknown kind unknown for a card the tank never held", async () => {
    const locked = await call(
      "PUT",
      { card: { id: "organic", author: "@bob", text: "GPU export controls" } },
      a.cookie,
    );
    assert.equal(locked.status, 200);
    const retained = readRetainedTargetContext(a.userId, "organic");
    assert.equal(retained?.threadKind, null);
    assert.equal(retained?.author, "bob");
    assert.equal(retained?.contextSource, "lock");
  });

  await it("reads back the current lock for this user only", async () => {
    const b = signIn("b");
    assert.deepEqual((await call("GET", undefined, a.cookie)).json, { ok: true, card: null, next: null });
    assert.equal(
      (await call("PUT", { card: { id: "c9", conversationId: "conv-9", author: "@dana", url: "https://x.com/dana/status/9", text: "hi", surface: "reply" } }, a.cookie)).status,
      200,
    );
    const read = await call("GET", undefined, a.cookie);
    assert.equal(read.status, 200);
    assert.deepEqual(read.json, {
      ok: true,
      card: {
        id: "c9",
        conversationId: "conv-9",
        inReplyToId: null,
        surface: "reply",
        author: "@dana",
        url: "https://x.com/dana/status/9",
        text: "hi",
      },
      next: null,
    });
    assert.deepEqual((await call("GET", undefined, b.cookie)).json, { ok: true, card: null, next: null });
    assert.equal((await call("PUT", { card: null }, a.cookie)).status, 200);
    assert.deepEqual((await call("GET", undefined, a.cookie)).json, { ok: true, card: null, next: null });
  });

  await it("publishes the card the desk would lock after Next beside the current lock", async () => {
    const upNext = { id: "c10", conversationId: null, inReplyToId: null, surface: "reply", author: "@eve", url: null, text: "next up" };
    assert.equal((await call("PUT", { card: { id: "c9" }, next: { card: upNext } }, a.cookie)).status, 200);
    assert.deepEqual((await call("GET", undefined, a.cookie)).json.next, { card: upNext });

    assert.equal((await call("PUT", { card: { id: "c9" }, next: { card: null } }, a.cookie)).status, 200);
    assert.deepEqual((await call("GET", undefined, a.cookie)).json.next, { card: null });

    assert.equal((await call("PUT", { card: null, next: { card: upNext } }, a.cookie)).status, 200);
    assert.deepEqual((await call("GET", undefined, a.cookie)).json, { ok: true, card: null, next: { card: upNext } });
  });

  await it("forgets the next card when a write does not name one", async () => {
    const upNext = { id: "c10", conversationId: null, inReplyToId: null, surface: "reply", author: null, url: null, text: null };
    assert.equal((await call("PUT", { card: { id: "c9" }, next: { card: upNext } }, a.cookie)).status, 200);
    assert.equal((await call("PUT", { card: { id: "c10" } }, a.cookie)).status, 200);
    assert.equal((await call("GET", undefined, a.cookie)).json.next, null);
    assert.equal((await call("PUT", { card: { id: "c10" }, next: { card: { id: " " } } }, a.cookie)).status, 200);
    assert.equal((await call("GET", undefined, a.cookie)).json.next, null);
  });

  await it("expires the next card with the lock's TTL", async () => {
    setScoutApproachNext(a.userId, { card: null });
    assert.deepEqual(getScoutApproachNext(a.userId), { card: null });
    assert.equal(getScoutApproachNext(a.userId, Date.now() + 25 * 60 * 60 * 1000), null);
  });

  await it("expires the lock after its TTL without touching retained context", async () => {
    setScoutApproachLock(a.userId, {
      id: "c2",
      conversationId: null,
      inReplyToId: null,
      surface: "reply",
      author: "@carol",
      url: null,
      text: null,
    });
    assert.equal(getScoutApproachLock(a.userId)?.id, "c2");
    assert.equal(
      getScoutApproachLock(a.userId, Date.now() + 25 * 60 * 60 * 1000),
      null,
    );
  });
});
