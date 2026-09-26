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
import { defaultMigrationsDir, getPlatformDb, resetPlatformDbForTests } from "../db.ts";
import { testRequest, testResponse } from "../http/http.testHelpers.ts";
import { isRecord } from "../platform/unknownValue.ts";
import { resetDeskEventsForTests, tryHandleDeskEvents } from "./deskEvents.ts";
import { listInteractionHistory } from "./interactionStore.ts";
import {
  catchUpOwnPosts,
  OWN_POST_CATCH_UP_PATH,
  tryHandleOwnPostCatchUp,
  tryHandleOwnPostCatchUpBeforeAuth,
} from "./ownPostCatchUp.ts";
import { seenActivityEvent } from "./ownPostStore.ts";

const X_USER_ID = "111";

const original = {
  id: "2001",
  text: "fresh original",
  created_at: "2026-09-26T10:00:00.000Z",
  author_id: X_USER_ID,
  conversation_id: "2001",
};

const reply = {
  id: "2002",
  text: "my reply",
  created_at: "2026-09-26T10:00:05.000Z",
  author_id: X_USER_ID,
  conversation_id: "1000",
  in_reply_to_user_id: "222",
  referenced_tweets: [{ type: "replied_to", id: "1000" }],
};

const includes = {
  users: [
    { id: X_USER_ID, username: "pilot" },
    { id: "222", username: "target" },
  ],
};

function streamRes() {
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
  return { res, chunks };
}

function listen(cookie: string): () => Array<{ event: string; data: unknown }> {
  const req = Object.assign(testRequest(), {
    method: "GET",
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res, chunks } = streamRes();
  assert.equal(tryHandleDeskEvents(req, res, new URL("http://localhost/api/desk/events")), true);
  return () =>
    [...chunks.join("").matchAll(/^event: (\w+)\ndata: (.*)$/gm)]
      .filter((match) => match[1] !== "ready")
      .map((match) => ({ event: match[1] ?? "", data: JSON.parse(match[2] ?? "null") as unknown }));
}

async function post(cookie?: string, method = "POST") {
  const req = Object.assign(testRequest(), {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let body = "";
  const res = Object.assign(new ServerResponse(req), {
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(chunk?: string) {
      if (chunk) body += chunk;
      return res;
    },
  });
  const handled = await tryHandleOwnPostCatchUp(
    req,
    res,
    new URL(`http://localhost${OWN_POST_CATCH_UP_PATH}`),
  );
  return { handled, status, json: body ? (JSON.parse(body) as unknown) : null };
}

await describe("own post catch-up on a visible return", async () => {
  let dir: string;
  let userId: string;
  let cookie: string;
  let xReads: URL[];
  const originalFetch = globalThis.fetch;
  let tweets: unknown[];

  beforeEach(() => {
    resetPlatformDbForTests();
    resetRateLimiterForTests();
    resetDeskEventsForTests();
    dir = mkdtempSync(join(tmpdir(), "x-own-post-catch-up-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.X_API_BEARER_TOKEN = "bearer";
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "catch-up",
      email: "catch-up@example.com",
      emailVerified: true,
    });
    userId = user.id;
    cookie = `${SESSION_COOKIE}=${createSession(user.id).token}`;
    const now = new Date().toISOString();
    getPlatformDb()
      .prepare(
        `INSERT INTO activity_subscriptions
           (user_id, x_user_id, subscription_id, webhook_id, paused_until, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?)`,
      )
      .run(userId, X_USER_ID, "sub-1", "webhook-1", now, now);
    xReads = [];
    tweets = [reply, original];
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      xReads.push(url);
      return new Response(
        JSON.stringify({ data: tweets, includes, meta: { result_count: tweets.length, next_token: "more" } }),
        { status: 200 },
      );
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetDeskEventsForTests();
    resetRateLimiterForTests();
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    delete process.env.X_API_BEARER_TOKEN;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("reads the newest five user tweets once without search or pagination and meters it", async () => {
    tweets = [original];
    const result = await post(cookie);
    assert.equal(result.handled, true);
    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { ok: true, stored: 1 });
    assert.equal(xReads.length, 1);
    const [read] = xReads;
    assert.equal(read?.origin, "https://api.x.com");
    assert.equal(read?.pathname, `/2/users/${X_USER_ID}/tweets`);
    assert.equal(read?.searchParams.get("max_results"), "5");
    assert.equal(read?.searchParams.get("exclude"), "retweets");
    assert.equal(read?.searchParams.has("pagination_token"), false);
    assert.equal(xReads.some((url) => url.pathname.includes("search")), false);
    const usage = getPlatformDb()
      .prepare(`SELECT path, posts_read FROM x_api_usage_events`)
      .all();
    assert.deepEqual(usage, [{ path: `/users/${X_USER_ID}/tweets`, posts_read: 1 }]);
    assert.equal(seenActivityEvent("post.create:2001"), true);
  });

  await it("publishes own_post with url and text for a new id and the interacted mark for a new reply", async () => {
    const events = listen(cookie);
    const result = await catchUpOwnPosts(userId, {
      memory: { knowledgeRoot: join(dir, "knowledge"), upsertMemory: false },
    });
    assert.deepEqual(result, { ok: true, stored: 2 });
    const published = events();
    assert.deepEqual(published.slice(0, 2), [
      {
        event: "own_post",
        data: {
          id: "2001",
          kind: "original",
          postedAt: "2026-09-26T10:00:00.000Z",
          url: "https://x.com/pilot/status/2001",
          text: "fresh original",
        },
      },
      {
        event: "own_post",
        data: {
          id: "2002",
          kind: "reply",
          postedAt: "2026-09-26T10:00:05.000Z",
          url: "https://x.com/pilot/status/2002",
          text: "my reply",
        },
      },
    ]);
    assert.equal(published.length, 3);
    assert.equal(published[2]?.event, "interacted");
    const interacted = published[2]?.data;
    assert.ok(isRecord(interacted));
    assert.equal(Number.isFinite(Date.parse(String(interacted.at))), true);
    assert.deepEqual(
      { ...interacted, at: undefined },
      {
        threadId: "1000",
        author: "@target",
        at: undefined,
        url: "https://x.com/target/status/1000",
        replyId: "2002",
        replyUrl: "https://x.com/pilot/status/2002",
        postedAt: "2026-09-26T10:00:05.000Z",
        conversationId: "1000",
        inReplyToId: "1000",
      },
    );
    const history = await listInteractionHistory({ userId, limit: 10 });
    assert.deepEqual(history.map((row) => row.replyId), ["2002"]);
  });

  await it("publishes nothing for an id the desk already has", async () => {
    tweets = [original];
    await post(cookie);
    const events = listen(cookie);
    const again = await post(cookie);
    assert.deepEqual(again.json, { ok: true, stored: 0 });
    assert.deepEqual(events(), []);
    assert.equal(xReads.length, 2);
  });

  await it("limits repeated metered reads to 40 per user per minute", async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      assert.equal((await post(cookie)).status, 200);
    }
    const limited = await post(cookie);
    assert.equal(limited.status, 429);
    assert.deepEqual(limited.json, { error: "rate_limited" });
    assert.equal(xReads.length, 40);
  });

  await it("stores and publishes nothing for a paused account", async () => {
    getPlatformDb()
      .prepare(`UPDATE activity_subscriptions SET paused_until = ? WHERE user_id = ?`)
      .run(new Date(Date.now() + 60_000).toISOString(), userId);
    const events = listen(cookie);
    const result = await post(cookie);
    assert.deepEqual(result.json, { ok: true, stored: 0, hold: "paused" });
    assert.deepEqual(events(), []);
    assert.deepEqual(getPlatformDb().prepare(`SELECT id FROM own_posts`).all(), []);
  });

  await it("does not look the username up when the X user id is missing", async () => {
    getPlatformDb().prepare(`DELETE FROM activity_subscriptions`).run();
    const result = await post(cookie);
    assert.equal(result.status, 409);
    assert.deepEqual(xReads, []);
  });

  await it("requires a signed-in POST", async () => {
    assert.equal((await post(undefined)).status, 401);
    const req = Object.assign(testRequest(), {
      method: "GET",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    });
    const { res, captured } = testResponse(req);
    assert.equal(
      await tryHandleOwnPostCatchUpBeforeAuth(
        req,
        res,
        new URL(`http://localhost${OWN_POST_CATCH_UP_PATH}`),
      ),
      true,
    );
    assert.equal(captured.status, 405);
    assert.deepEqual(xReads, []);
  });
});
