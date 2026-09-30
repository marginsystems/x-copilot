import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ServerResponse } from "node:http";
import { expectRecord, testRequest } from "../http/http.testHelpers.ts";
import { getPlatformDb } from "../db.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { markInteracted } from "../desk/interactionStore.ts";
import type { xApiGet } from "../x-api/xApi.ts";
import {
  hydrateCircleProfiles,
  resetCircleHydrationForTests,
  staleCircleHandles,
  tryHandleCircle,
} from "./circleHttp.ts";
import { getXProfiles, recordCircleLinks } from "./circleStore.ts";

async function call(path: string, cookie?: string) {
  const req = testRequest();
  Object.assign(req, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  let headers: Record<string, string> = {};
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead: (code: number, written?: Record<string, string>) => {
      status = code;
      headers = written ?? {};
    },
    end: (chunk?: string) => {
      raw = chunk ?? "";
    },
  });
  const handled = await tryHandleCircle(req, res, new URL(`http://localhost${path}`));
  return { handled, status, headers, json: raw ? expectRecord(JSON.parse(raw)) : {} };
}

await describe("circleHttp", async () => {
  let temp: TempPlatformDb;
  const savedBearer = process.env.X_API_BEARER_TOKEN;

  beforeEach(() => {
    delete process.env.X_API_BEARER_TOKEN;
    resetCircleHydrationForTests();
    temp = openTempPlatformDb("x-circle-http-");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
    if (savedBearer === undefined) delete process.env.X_API_BEARER_TOKEN;
    else process.env.X_API_BEARER_TOKEN = savedBearer;
  });

  await it("ignores other routes", async () => {
    assert.equal((await call("/api/circles")).handled, false);
  });

  await it("GET /api/circle without a session is 401", async () => {
    const { handled, status, json } = await call("/api/circle");
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.deepEqual(json, { error: "unauthenticated", message: "Sign in required" });
  });

  await it("GET /api/circle returns self, ranked members, and totals", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-circle",
      email: "c@example.com",
      emailVerified: true,
      displayName: "Circle Me",
    });
    getPlatformDb().prepare(`UPDATE users SET x_username = ? WHERE id = ?`).run("CircleMe", user.id);
    await markInteracted({ threadId: "t1", author: "@alice", userId: user.id, replyId: "r1" });
    await markInteracted({ threadId: "t2", author: "@CircleMe", userId: user.id, replyId: "r2" });
    recordCircleLinks(user.id, [
      { postId: "q1", authorKey: "bob", kind: "quote", at: "2026-09-01T00:00:00.000Z" },
    ]);
    const { token } = createSession(user.id);
    const { status, json, headers } = await call(
      "/api/circle",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    assert.equal(headers["Cache-Control"], "private, no-cache");
    assert.equal(json.handle, "CircleMe");
    assert.equal(json.name, "Circle Me");
    assert.equal(json.avatarUrl, null);
    assert.equal(typeof json.generatedAt, "string");
    assert.deepEqual(json.totals, { replies: 1, quotes: 1, people: 2 });
    const members = json.members;
    assert.ok(Array.isArray(members));
    assert.deepEqual(
      members.map((m) => [expectRecord(m).handle, expectRecord(m).score]),
      [["bob", 2], ["alice", 1]],
    );
  });

  await it("hydrates stale handles with one users/by call", async () => {
    const calls: Record<string, string | undefined>[] = [];
    const fetchUsers: typeof xApiGet = (opts) => {
      calls.push({ path: opts.path, ...opts.query });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: {
          data: [
            {
              id: "1",
              username: "Alice",
              name: "Alice A",
              profile_image_url: "https://pbs.twimg.com/profile_images/1/a_normal.jpg",
            },
          ],
        },
      });
    };
    const nowMs = Date.parse("2026-09-30T00:00:00.000Z");
    const written = await hydrateCircleProfiles({ handles: ["Alice", "bob"], nowMs, fetchUsers });
    assert.equal(written, 1);
    assert.deepEqual(calls, [
      { path: "/users/by", usernames: "Alice,bob", "user.fields": "profile_image_url,name" },
    ]);
    const profiles = getXProfiles(["alice", "bob"]);
    assert.equal(
      profiles.get("alice")?.avatarUrl,
      "https://pbs.twimg.com/profile_images/1/a_400x400.jpg",
    );
    const member = { name: null, avatarUrl: null, replies: 1, quotes: 0, score: 1, lastAt: "" };
    assert.deepEqual(
      staleCircleHandles(
        [{ ...member, handle: "Alice" }, { ...member, handle: "bob" }],
        profiles,
        nowMs + 8 * 24 * 60 * 60_000,
      ),
      ["Alice", "bob"],
    );
    assert.deepEqual(
      staleCircleHandles([{ ...member, handle: "Alice" }], profiles, nowMs + 60_000),
      [],
    );
  });

  await it("a failed users/by call writes nothing", async () => {
    const fetchUsers: typeof xApiGet = () =>
      Promise.resolve({ ok: false, status: 429, error: "rate_limited", message: "slow down" });
    assert.equal(await hydrateCircleProfiles({ handles: ["alice"], nowMs: 0, fetchUsers }), 0);
  });
});
