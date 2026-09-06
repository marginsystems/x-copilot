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
import { updateUserAgenda } from "./authStore.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import { MIN_T24H_SNAPSHOTS } from "./forYouDigest.ts";
import {
  chooseDeskFork,
  getDeskBeats,
  recordDeskReplyMarked,
} from "./deskBeats.ts";
import { tryHandleForYou } from "./forYouHttp.ts";
import {
  getSuggestion,
  insertSuggestions,
  listActiveSuggestions,
} from "./forYouStore.ts";
import { patchOwnPostSnapshot, upsertOwnPost } from "./ownPostStore.ts";
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
    updateUserAgenda(user.id, "Find builders shipping AI tools");
    let drafts = 0;
    const chat: ChatFn = async () => {
      drafts += 1;
      return extraChat();
    };
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
      { chat },
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
    assert.equal(drafts, 0);
  });
});

async function invokeForYou(opts: {
  method: string;
  path: string;
  token?: string;
  chat?: ChatFn;
  body?: unknown;
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
  const handledP = tryHandleForYou(
    req,
    res,
    new URL(`http://localhost${opts.path}`),
    opts.chat ? { chat: opts.chat } : undefined,
  );
  if (opts.body !== undefined) {
    queueMicrotask(() => {
      req.emit("data", Buffer.from(JSON.stringify(opts.body)));
      req.emit("end");
    });
  }
  const handled = await handledP;
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
      {
        kind: "post",
        why: "open weights just dropped",
        draft: "Which agent shipped first?",
      },
      {
        kind: "post",
        why: "quiet launch window",
        draft: "Is the other side just slow?",
      },
      {
        kind: "post",
        why: "builders are shipping tonight",
        draft: "I'll take the under — prove me wrong.",
      },
    ],
  }),
  model: "deepseek-v4-flash",
  provider: "deepseek",
});

describe("POST /api/for-you/done", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fydone-"));
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

  it("advances the organic beat on quote I posted", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-quote-done",
      email: "quote-done@example.com",
      emailVerified: true,
    });
    const [card] = insertSuggestions({
      userId: user.id,
      tenantId: "local",
      drafts: [{ kind: "quote", why: "quote the win", draft: "sharper" }],
    });
    assert.ok(card);
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/done",
      token,
      body: { id: card.id },
    });
    assert.equal(out.status, 200);
    assert.equal(getDeskBeats({ userId: user.id }).organicReplyDone, true);
  });

  it("does not complete a reply fork on quote I posted", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-quote-reply-fork",
      email: "quote-reply-fork@example.com",
      emailVerified: true,
    });
    const [card] = insertSuggestions({
      userId: user.id,
      tenantId: "local",
      drafts: [{ kind: "quote", why: "quote the win", draft: "sharper" }],
    });
    assert.ok(card);
    recordDeskReplyMarked({ userId: user.id, source: "organic" });
    chooseDeskFork({ userId: user.id, forkChoice: "reply" });
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/done",
      token,
      body: { id: card.id },
    });
    assert.equal(out.status, 200);
    const beats = getDeskBeats({ userId: user.id });
    assert.equal(beats.forkDone, false);
    assert.equal(beats.organicReplyDone, true);
  });

  it("completes a reply fork on reply I posted", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-reply-reply-fork",
      email: "reply-reply-fork@example.com",
      emailVerified: true,
    });
    const [card] = insertSuggestions({
      userId: user.id,
      tenantId: "local",
      drafts: [{ kind: "reply", why: "reply to the win", draft: "sharper" }],
    });
    assert.ok(card);
    recordDeskReplyMarked({ userId: user.id, source: "organic" });
    chooseDeskFork({ userId: user.id, forkChoice: "reply" });
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/done",
      token,
      body: { id: card.id },
    });
    assert.equal(out.status, 200);
    assert.equal(getDeskBeats({ userId: user.id }).forkDone, true);
  });
});

describe("POST /api/for-you/skip", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fyskip-"));
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

  it("marks the card skipped and inserts a Scout-based original", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-skip-refill",
      email: "skip-refill@example.com",
      emailVerified: true,
    });
    updateUserAgenda(user.id, "Find builders shipping AI tools");
    const [card] = insertSuggestions({
      userId: user.id,
      tenantId: "local",
      drafts: [
        {
          kind: "post",
          why: "Hiring thread is live. Take a side.",
          draft: "Who is actually hiring this week?",
        },
      ],
    });
    assert.ok(card);
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/skip",
      token,
      chat: extraChat,
      body: { id: card.id },
    });
    assert.equal(out.status, 200);
    const replacement = out.json.replacement as { why?: string; draft?: string } | null;
    assert.ok(replacement?.draft);
    assert.notEqual(replacement.draft, card.draft);
    const live = listActiveSuggestions(user.id);
    assert.equal(live.some((row) => row.id === card.id), false);
    assert.equal(live.some((row) => row.kind === "post"), true);
    assert.equal(getSuggestion(card.id, user.id)?.status, "skipped");
  });

  it("marks Not interested dismissed without refilling", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-dismiss",
      email: "dismiss@example.com",
      emailVerified: true,
    });
    updateUserAgenda(user.id, "Find builders shipping AI tools");
    const [card] = insertSuggestions({
      userId: user.id,
      tenantId: "local",
      drafts: [{ kind: "post", why: "A live launch", draft: "Take a side." }],
    });
    assert.ok(card);
    let drafts = 0;
    const chat: ChatFn = async () => {
      drafts += 1;
      return extraChat();
    };
    const { token } = createSession(user.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/dismiss",
      token,
      chat,
      body: { id: card.id },
    });
    assert.equal(out.status, 200);
    assert.equal(getSuggestion(card.id, user.id)?.status, "dismissed");
    assert.deepEqual(out.json.suggestions, []);
    assert.equal(out.json.replacement, null);
    assert.equal(drafts, 0);
  });

  it("does not let another user act on a suggestion", async () => {
    const owner = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-owner",
      email: "owner@example.com",
      emailVerified: true,
    });
    const other = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-other",
      email: "other@example.com",
      emailVerified: true,
    });
    const [card] = insertSuggestions({
      userId: owner.id,
      tenantId: "local",
      drafts: [{ kind: "post", why: "Owner only", draft: "Private card." }],
    });
    assert.ok(card);
    const { token } = createSession(other.id);
    const out = await invokeForYou({
      method: "POST",
      path: "/api/for-you/skip",
      token,
      body: { id: card.id },
    });
    assert.equal(out.status, 404);
    assert.equal(getSuggestion(card.id, owner.id)?.status, "suggested");
  });
});
