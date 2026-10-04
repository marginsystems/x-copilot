import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { resetRateLimiterForTests } from "../auth/authGuard.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { defaultMigrationsDir, getPlatformDb, resetPlatformDbForTests } from "../db.ts";
import { expectRecord, testRequest } from "../http/http.testHelpers.ts";
import type { ParsedPostCreate } from "../x-api/xActivity.ts";
import { resetDeskEventsForTests, tryHandleDeskEvents } from "./deskEvents.ts";
import { countOwnPostsSince, upsertOwnPost } from "./ownPostStore.ts";
import {
  OWN_POST_CONFIRM_WINDOW_MS,
  OWN_POST_SEEN_PATH,
  parseSeenOwnPost,
  provisionalPostedAt,
  recordSeenOwnPost,
  seenOwnPostState,
  settleSeenOwnPosts,
  stopOwnPostConfirmSweepForTests,
  tryHandleOwnPostSeen,
} from "./ownPostSeen.ts";

const SNOWFLAKE_EPOCH_MS = 1288834974657;
const SEEN_AT_MS = Date.parse("2026-10-04T12:00:00.000Z");
const POSTED_AT_MS = SEEN_AT_MS - 2_000;
const POST_ID = String(BigInt(POSTED_AT_MS - SNOWFLAKE_EPOCH_MS) << 22n);
const POST_URL = `https://x.com/pilot/status/${POST_ID}`;
const SEEN = { postId: POST_ID, url: POST_URL, pageStatusId: null };

function listen(cookie: string): () => Array<{ event: string; data: unknown }> {
  const req = Object.assign(testRequest(), {
    method: "GET",
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const chunks: string[] = [];
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead() {
      return res;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    once() {
      return res;
    },
  });
  assert.equal(tryHandleDeskEvents(req, res, new URL("http://localhost/api/desk/events")), true);
  return () =>
    [...chunks.join("").matchAll(/^event: (\w+)\ndata: (.*)$/gm)]
      .filter((match) => match[1] !== "ready")
      .map((match) => ({ event: match[1] ?? "", data: JSON.parse(match[2] ?? "null") as unknown }));
}

async function post(body: unknown, cookie?: string, method = "POST") {
  const req = Object.assign(testRequest(), {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string) {
      raw = chunk ?? "";
      return res;
    },
  });
  const handled = tryHandleOwnPostSeen(req, res, new URL(`http://localhost${OWN_POST_SEEN_PATH}`));
  req.emit("data", Buffer.from(JSON.stringify(body)));
  req.emit("end");
  return { handled: await handled, status, json: raw ? expectRecord(JSON.parse(raw)) : {} };
}

function seenRows(): unknown[] {
  return getPlatformDb()
    .prepare(`SELECT user_id, post_id, confirmed_at, unconfirmed_at FROM extension_seen_posts`)
    .all();
}

await describe("own posts the extension saw land on X", async () => {
  let dir: string;
  let userId: string;
  let cookie: string;

  function ingestFromX(): boolean {
    const parsed: ParsedPostCreate = {
      eventUuid: `post.create:${POST_ID}`,
      postId: POST_ID,
      xUserId: "111",
      authorUsername: "pilot",
      kind: "original",
      text: "posted from X",
      postedAt: new Date(POSTED_AT_MS).toISOString(),
      inReplyToId: null,
      inReplyToUserId: null,
      conversationId: POST_ID,
      metrics: {},
    };
    return upsertOwnPost({ parsed, userId, tenantId: ensureUserTenant(userId) });
  }

  beforeEach(() => {
    resetPlatformDbForTests();
    resetRateLimiterForTests();
    resetDeskEventsForTests();
    dir = mkdtempSync(join(tmpdir(), "x-own-post-seen-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "seen",
      email: "seen@example.com",
      emailVerified: true,
    });
    userId = user.id;
    cookie = `${SESSION_COOKIE}=${createSession(user.id).token}`;
  });

  afterEach(() => {
    stopOwnPostConfirmSweepForTests();
    resetDeskEventsForTests();
    resetRateLimiterForTests();
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("reads the post time from the id and falls back to now for an id that carries no recent time", () => {
    assert.equal(provisionalPostedAt(POST_ID, SEEN_AT_MS), new Date(POSTED_AT_MS).toISOString());
    assert.equal(provisionalPostedAt("555", SEEN_AT_MS), new Date(SEEN_AT_MS).toISOString());
  });

  await it("accepts a numeric post id and drops a url that does not name that post", () => {
    assert.deepEqual(parseSeenOwnPost({ postId: POST_ID, url: POST_URL, pageStatusId: "900" }), {
      postId: POST_ID,
      url: POST_URL,
      pageStatusId: "900",
    });
    assert.deepEqual(parseSeenOwnPost({ postId: POST_ID, url: "https://evil.example/pilot/status/1" }), {
      postId: POST_ID,
      url: `https://x.com/i/status/${POST_ID}`,
      pageStatusId: null,
    });
    assert.equal(parseSeenOwnPost({ postId: "not-a-post", url: POST_URL }), null);
    assert.equal(parseSeenOwnPost({ postId: POST_ID, url: POST_URL, pageStatusId: "x" }), null);
    assert.equal(parseSeenOwnPost(null), null);
  });

  await it("records a provisional post and wakes the open desk at once", () => {
    const events = listen(cookie);
    assert.equal(recordSeenOwnPost(userId, SEEN, SEEN_AT_MS), "provisional");
    assert.deepEqual(events(), [
      {
        event: "own_post",
        data: {
          id: POST_ID,
          kind: "original",
          postedAt: new Date(POSTED_AT_MS).toISOString(),
          url: POST_URL,
          text: "",
          provisional: true,
        },
      },
    ]);
    assert.equal(seenOwnPostState(userId, POST_ID), "provisional");
    assert.equal(countOwnPostsSince(userId, new Date(0).toISOString()), 0);
  });

  await it("calls a post written on a status page a reply", () => {
    const events = listen(cookie);
    recordSeenOwnPost(userId, { ...SEEN, pageStatusId: "900" }, SEEN_AT_MS);
    assert.equal(expectRecord(events()[0]?.data).kind, "reply");
  });

  await it("records a repeated report once and wakes the desk once", () => {
    const events = listen(cookie);
    recordSeenOwnPost(userId, SEEN, SEEN_AT_MS);
    assert.equal(recordSeenOwnPost(userId, SEEN, SEEN_AT_MS + 1_000), "provisional");
    assert.equal(events().length, 1);
    assert.equal(seenRows().length, 1);
  });

  await it("confirms the provisional post when X ingests the same id, with one own post counted", () => {
    recordSeenOwnPost(userId, SEEN, SEEN_AT_MS);
    assert.equal(ingestFromX(), true);
    assert.equal(ingestFromX(), false);
    assert.equal(seenOwnPostState(userId, POST_ID), "confirmed");
    assert.equal(countOwnPostsSince(userId, new Date(0).toISOString()), 1);
    const events = listen(cookie);
    assert.deepEqual(settleSeenOwnPosts(SEEN_AT_MS + OWN_POST_CONFIRM_WINDOW_MS), []);
    assert.deepEqual(events(), []);
    assert.equal(seenOwnPostState(userId, POST_ID), "confirmed");
    assert.equal(seenRows().length, 1);
  });

  await it("stays quiet when X ingested the post before the extension reported it", () => {
    ingestFromX();
    const events = listen(cookie);
    assert.equal(recordSeenOwnPost(userId, SEEN, SEEN_AT_MS), "confirmed");
    assert.deepEqual(events(), []);
    assert.deepEqual(settleSeenOwnPosts(SEEN_AT_MS + OWN_POST_CONFIRM_WINDOW_MS), []);
    assert.equal(countOwnPostsSince(userId, new Date(0).toISOString()), 1);
  });

  await it("flags a post X has not confirmed inside the window, once", () => {
    recordSeenOwnPost(userId, SEEN, SEEN_AT_MS);
    const events = listen(cookie);
    assert.deepEqual(settleSeenOwnPosts(SEEN_AT_MS + OWN_POST_CONFIRM_WINDOW_MS - 1), []);
    assert.equal(seenOwnPostState(userId, POST_ID), "provisional");
    const seenAt = new Date(SEEN_AT_MS).toISOString();
    assert.deepEqual(settleSeenOwnPosts(SEEN_AT_MS + OWN_POST_CONFIRM_WINDOW_MS), [
      { userId, id: POST_ID, url: POST_URL, seenAt },
    ]);
    assert.equal(seenOwnPostState(userId, POST_ID), "unconfirmed");
    assert.deepEqual(settleSeenOwnPosts(SEEN_AT_MS + 2 * OWN_POST_CONFIRM_WINDOW_MS), []);
    assert.deepEqual(events(), [
      { event: "own_post_unconfirmed", data: { id: POST_ID, url: POST_URL, seenAt } },
    ]);
  });

  await it("publishes confirmation when the sweep sees a flagged post ingested by X", () => {
    recordSeenOwnPost(userId, SEEN, SEEN_AT_MS);
    settleSeenOwnPosts(SEEN_AT_MS + OWN_POST_CONFIRM_WINDOW_MS);
    const events = listen(cookie);
    ingestFromX();
    assert.deepEqual(settleSeenOwnPosts(SEEN_AT_MS + OWN_POST_CONFIRM_WINDOW_MS + 1), []);
    assert.equal(seenOwnPostState(userId, POST_ID), "confirmed");
    assert.deepEqual(events(), [
      {
        event: "own_post",
        data: {
          id: POST_ID,
          kind: "original",
          postedAt: new Date(POSTED_AT_MS).toISOString(),
          url: POST_URL,
          text: "posted from X",
        },
      },
    ]);
  });

  await it("takes the report over HTTP from a signed-in user only", async () => {
    const events = listen(cookie);
    assert.equal((await post(SEEN)).status, 401);
    assert.equal((await post(SEEN, cookie, "GET")).status, 405);
    assert.equal((await post({ postId: "nope" }, cookie)).status, 400);
    const result = await post({ postId: POST_ID, url: POST_URL }, cookie);
    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { ok: true, state: "provisional" });
    assert.equal(events().length, 1);
    assert.equal(seenRows().length, 1);
  });
});
