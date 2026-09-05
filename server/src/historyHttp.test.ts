import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { markDismissed } from "./dismissalStore.ts";
import { markExpired } from "./expiredStore.ts";
import { tryHandleHistory } from "./historyHttp.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import { markSkipped } from "./skipStore.ts";

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
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handledPromise = tryHandleHistory(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req as EventEmitter).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("historyHttp", () => {
  let temp: TempPlatformDb;
  let a: { userId: string; cookie: string };
  let b: { userId: string; cookie: string };

  beforeEach(() => {
    temp = openTempPlatformDb("x-history-http-");
    a = signIn("a");
    b = signIn("b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  it("GET /api/expired returns expired + expiredIds", async () => {
    const { handled, status, json } = await call("GET", "/api/expired");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.expired));
    assert.ok(Array.isArray(json.expiredIds));
  });

  it("GET /api/dismissed strips authorKey from the list", async () => {
    await markDismissed({ threadId: "d1", author: "@d", userId: a.userId });
    const { handled, status, json } = await call(
      "GET",
      "/api/dismissed",
      undefined,
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal((json.dismissals as unknown[]).length, 1);
    assert.deepEqual(json.dismissedIds, ["d1"]);
    for (const row of json.dismissals as Record<string, unknown>[]) {
      assert.equal("authorKey" in row, false);
    }
  });

  it("GET /api/skipped strips authorKey from the list", async () => {
    await markSkipped({ threadId: "s1", author: "@s", userId: a.userId });
    const { handled, status, json } = await call(
      "GET",
      "/api/skipped",
      undefined,
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal((json.skipped as unknown[]).length, 1);
    assert.deepEqual(json.skippedIds, ["s1"]);
    for (const row of json.skipped as Record<string, unknown>[]) {
      assert.equal("authorKey" in row, false);
    }
  });

  it("GET without a session returns empty lists, never another user's rows", async () => {
    await markSkipped({ threadId: "s1", author: "@s", userId: a.userId });
    await markDismissed({ threadId: "d1", author: "@d", userId: a.userId });
    await markExpired({ threadId: "e1", author: "@e", userId: a.userId });
    const skipped = await call("GET", "/api/skipped");
    const dismissed = await call("GET", "/api/dismissed");
    const expired = await call("GET", "/api/expired");
    assert.equal(skipped.status, 200);
    assert.deepEqual(skipped.json.skipped, []);
    assert.deepEqual(skipped.json.skippedIds, []);
    assert.deepEqual(dismissed.json.dismissals, []);
    assert.deepEqual(dismissed.json.dismissedIds, []);
    assert.deepEqual(expired.json.expired, []);
    assert.deepEqual(expired.json.expiredIds, []);
  });

  it("POST /api/skipped and /api/dismissed without a session return 401", async () => {
    const body = { threadId: "t1", author: "@x" };
    for (const path of ["/api/skipped", "/api/dismissed"]) {
      const { handled, status, json } = await call("POST", path, body);
      assert.equal(handled, true, path);
      assert.equal(status, 401, path);
      assert.equal(json.error, "unauthenticated", path);
    }
    assert.deepEqual(
      (await call("GET", "/api/skipped", undefined, a.cookie)).json.skippedIds,
      [],
    );
  });

  it("POST writes to the session user only and does not hide the thread for B", async () => {
    const skip = await call(
      "POST",
      "/api/skipped",
      { threadId: "shared", author: "@x", text: "a skipped this" },
      a.cookie,
    );
    assert.equal(skip.status, 200);
    const dismiss = await call(
      "POST",
      "/api/dismissed",
      { threadId: "shared-2", author: "@y", reason: "off topic" },
      a.cookie,
    );
    assert.equal(dismiss.status, 200);

    const aSkipped = await call("GET", "/api/skipped", undefined, a.cookie);
    const bSkipped = await call("GET", "/api/skipped", undefined, b.cookie);
    assert.deepEqual(aSkipped.json.skippedIds, ["shared"]);
    assert.deepEqual(bSkipped.json.skippedIds, []);

    const aDismissed = await call("GET", "/api/dismissed", undefined, a.cookie);
    const bDismissed = await call("GET", "/api/dismissed", undefined, b.cookie);
    assert.deepEqual(aDismissed.json.dismissedIds, ["shared-2"]);
    assert.deepEqual(bDismissed.json.dismissedIds, []);
  });

  it("POST /api/skipped stores conversation ancestry for the session user", async () => {
    const response = await call(
      "POST",
      "/api/skipped",
      {
        threadId: "reply-1",
        author: "@x",
        conversationId: "root-1",
        inReplyToId: "root-1",
      },
      a.cookie,
    );
    assert.equal(response.status, 200);

    const forA = await call("GET", "/api/skipped", undefined, a.cookie);
    const [row] = forA.json.skipped as Record<string, unknown>[];
    assert.equal(row?.conversationId, "root-1");
    assert.equal(row?.inReplyToId, "root-1");

    const forB = await call("GET", "/api/skipped", undefined, b.cookie);
    assert.deepEqual(forB.json.skipped, []);
  });

  it("GET /api/expired returns only the session user's rows", async () => {
    await markExpired({ threadId: "ea", author: "@a", userId: a.userId });
    await markExpired({ threadId: "eb", author: "@b", userId: b.userId });
    const forA = await call("GET", "/api/expired", undefined, a.cookie);
    const forB = await call("GET", "/api/expired", undefined, b.cookie);
    assert.deepEqual(forA.json.expiredIds, ["ea"]);
    assert.deepEqual(forB.json.expiredIds, ["eb"]);
  });

  it("POST /api/skipped rejects a missing threadId or author", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/skipped",
      { threadId: "t1" },
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("POST /api/dismissed rejects a missing threadId or author", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/dismissed",
      { author: "@x" },
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await call("GET", "/api/interacted");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
