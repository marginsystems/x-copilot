import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import { countPostsReadThisUtcMonth } from "./billingQuotas.ts";
import { ensureUserTenant } from "./billingStore.ts";
import { MIN_T24H_SNAPSHOTS } from "./forYouDigest.ts";
import { countExtraBatchesToday, reserveExtraSlot } from "./forYouExtra.ts";
import { tryHandleForYou } from "./forYouHttp.ts";
import { insertSuggestions, listActiveSuggestions } from "./forYouStore.ts";
import { patchOwnPostSnapshot, upsertOwnPost } from "./ownPostStore.ts";
import { recordUsageEvent } from "./usageMeter.ts";
import type { ChatFn } from "./voiceLlm.ts";

describe("GET /api/for-you", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fyhttp-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("reports how many 24h snapshots are tracked toward the digest", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-fy",
      email: "fy@example.com",
      emailVerified: true,
    });
    for (let i = 1; i <= 3; i++) {
      upsertOwnPost({
        parsed: {
          eventUuid: `evt-${i}`,
          xUserId: "99",
          postId: `p${i}`,
          kind: "original",
          text: `post ${i}`,
          postedAt: "2026-08-15T12:00:00.000Z",
          inReplyToId: null,
          inReplyToUserId: null,
          conversationId: null,
          authorUsername: "desk",
          metrics: { views: 10, likes: 1, replies: 0, retweets: 0, bookmarks: 0 },
        },
        userId: user.id,
        tenantId: "local",
      });
      patchOwnPostSnapshot(`p${i}`, "t24h", {
        views: 80,
        likes: 1,
        replies: 0,
        retweets: 0,
        bookmarks: 0,
      });
    }
    const { token } = createSession(user.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "GET",
      headers: {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      },
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
    const handled = await tryHandleForYou(
      req,
      res,
      new URL("http://localhost/api/for-you"),
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    const json = JSON.parse(raw) as {
      tracked?: number;
      needed?: number;
      suggestions?: unknown[];
      extra?: { cost?: number; batchSize?: number; used?: number; limit?: number };
    };
    assert.equal(json.tracked, 3);
    assert.equal(json.needed, MIN_T24H_SNAPSHOTS);
    assert.deepEqual(json.suggestions, []);
    assert.equal(json.extra?.cost, 15);
    assert.equal(json.extra?.batchSize, 3);
    assert.equal(json.extra?.used, 0);
    assert.equal(json.extra?.limit, 10);
  });
});

function ageUser(userId: string, days: number): void {
  const at = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  getPlatformDb()
    .prepare(`UPDATE users SET created_at = ? WHERE id = ?`)
    .run(at, userId);
}

function seedSnapshots(userId: string, n: number): void {
  for (let i = 1; i <= n; i++) {
    upsertOwnPost({
      parsed: {
        eventUuid: `evt-x-${i}`,
        xUserId: "99",
        postId: `px${i}`,
        kind: "original",
        text: `post ${i}`,
        postedAt: "2026-08-15T12:00:00.000Z",
        inReplyToId: null,
        inReplyToUserId: null,
        conversationId: null,
        authorUsername: "desk",
        metrics: { views: 10, likes: 1, replies: 0, retweets: 0, bookmarks: 0 },
      },
      userId,
      tenantId: "local",
    });
    patchOwnPostSnapshot(`px${i}`, "t24h", {
      views: 80,
      likes: 1,
      replies: 0,
      retweets: 0,
      bookmarks: 0,
    });
  }
}

async function invokeForYou(opts: {
  method: string;
  path: string;
  token?: string;
  chat?: ChatFn;
}): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: opts.method,
    headers: opts.token
      ? { cookie: `${SESSION_COOKIE}=${encodeURIComponent(opts.token)}` }
      : {},
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
  const handled = await tryHandleForYou(
    req,
    res,
    new URL(`http://localhost${opts.path}`),
    opts.chat ? { chat: opts.chat } : undefined,
  );
  return {
    handled,
    status,
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

const extraChat: ChatFn = async () => ({
  ok: true,
  content: JSON.stringify({
    actions: [
      { kind: "post", why: "900 views on the recap", draft: "What would you cut first?" },
      { kind: "post", why: "4 replies on the recap", draft: "Is the other side just slow?" },
      { kind: "post", why: "20 likes on the recap", draft: "I'll take the under — prove me wrong." },
    ],
  }),
  model: "deepseek-v4-flash",
  provider: "deepseek",
});

describe("POST /api/for-you/extra", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fyextra-http-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    delete process.env.ADMIN_EMAILS;
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("401s without a session", async () => {
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
    });
    assert.equal(out.handled, true);
    assert.equal(out.status, 401);
  });

  it("409s before five 24h snapshots", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra-thin",
      email: "thin@example.com",
      emailVerified: true,
    });
    seedSnapshots(user.id, 3);
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
      token,
      chat: extraChat,
    });
    assert.equal(out.status, 409);
    assert.equal(out.json.error, "extra_not_ready");
  });

  it("402s when fewer than 15 credits remain", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra-402",
      email: "broke@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    ageUser(user.id, 8);
    seedSnapshots(user.id, MIN_T24H_SNAPSHOTS);
    recordUsageEvent({
      tenantId,
      path: "/2/tweets/search/recent",
      status: 200,
      postsRead: 1490,
    });
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
      token,
      chat: extraChat,
    });
    assert.equal(out.status, 402);
    assert.equal(out.json.error, "credits_exhausted");
    assert.ok(out.json.extra);
    assert.equal(countExtraBatchesToday(user.id), 0);
    assert.equal(countPostsReadThisUtcMonth(tenantId), 1490);
  });

  it("429s after ten extra batches today", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra-cap",
      email: "cap@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    seedSnapshots(user.id, MIN_T24H_SNAPSHOTS);
    for (let i = 0; i < 10; i++) {
      assert.ok(reserveExtraSlot(user.id, tenantId));
    }
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
      token,
      chat: extraChat,
    });
    assert.equal(out.status, 429);
    assert.equal(out.json.error, "extra_daily_limit");
    assert.ok(out.json.extra);
    assert.equal(countPostsReadThisUtcMonth(tenantId), 0);
  });

  it("inserts three originals and debits 15 credits", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra-ok",
      email: "ok@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    seedSnapshots(user.id, MIN_T24H_SNAPSHOTS);
    insertSuggestions({
      userId: user.id,
      tenantId,
      drafts: [
        { kind: "reply", why: "leftover scout", draft: "hey", targetId: "77" },
      ],
    });
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
      token,
      chat: extraChat,
    });
    assert.equal(out.status, 200);
    const suggestions = out.json.suggestions as Array<{ kind?: string }>;
    assert.equal(suggestions.length, 3);
    assert.ok(suggestions.every((row) => row.kind === "post"));
    assert.equal(listActiveSuggestions(user.id).length, 4);
    assert.equal(countPostsReadThisUtcMonth(tenantId), 15);
    assert.equal(countExtraBatchesToday(user.id), 1);
    const extra = out.json.extra as { used?: number; remaining?: number };
    assert.equal(extra.used, 1);
    assert.equal(extra.remaining, 9);
  });

  it("402s when credits run out while drafting", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra-midflight",
      email: "midflight@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    ageUser(user.id, 8);
    seedSnapshots(user.id, MIN_T24H_SNAPSHOTS);
    const { token } = createSession(user.id);
    const chat: ChatFn = async () => {
      recordUsageEvent({
        tenantId,
        path: "/2/tweets/search/recent",
        status: 200,
        postsRead: 1486,
      });
      return {
        ok: true,
        content: JSON.stringify({
          actions: [
            { kind: "post", why: "traction on the recap", draft: "Agree or disagree?" },
            { kind: "post", why: "a reply chain is blowing up", draft: "The over/under is off." },
            { kind: "post", why: "quiet week", draft: "No way it stays this calm." },
          ],
        }),
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
      token,
      chat,
    });
    assert.equal(out.status, 402);
    assert.equal(out.json.error, "credits_exhausted");
    assert.equal(listActiveSuggestions(user.id).length, 0);
    assert.equal(countPostsReadThisUtcMonth(tenantId), 1486);
    assert.equal(countExtraBatchesToday(user.id), 0);
  });

  it("does not debit when the model fails", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra-fail",
      email: "fail@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    seedSnapshots(user.id, MIN_T24H_SNAPSHOTS);
    const { token } = createSession(user.id);
    const chat: ChatFn = async () => ({
      ok: false,
      status: 500,
      error: "upstream",
      message: "Upstream blew up",
    });
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/extra",
      token,
      chat,
    });
    assert.equal(out.status, 502);
    assert.equal(listActiveSuggestions(user.id).length, 0);
    assert.equal(countPostsReadThisUtcMonth(tenantId), 0);
    assert.equal(countExtraBatchesToday(user.id), 0);
  });
});
