import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { saveXWriteCreds, upsertOauthUser } from "./authStore.ts";
import { recordDeskPost } from "./xPostLimits.ts";
import {
  SUGGESTION_TTL_MS,
  insertSuggestions,
  listActiveSuggestions,
  markSuggestion,
} from "./forYouStore.ts";
import type { AuthUser } from "./authStore.ts";
import { createSession } from "./sessionStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import {
  deriveNeedsLearn,
  deriveVoiceUiStatus,
  shouldPullXApi,
  tryHandleVoice,
} from "./voiceHttp.ts";
import {
  effectivePlanKey,
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.ts";
import { getSuggestUsage, type VoiceProfileRow } from "./voiceStore.ts";
import { PLAN_DAILY_SUGGESTS } from "./plans.ts";
import type { ChatMessage } from "./deepseek.js";
import type { ChatFn } from "./voiceLlm.ts";

function profile(
  overrides: Partial<VoiceProfileRow> = {},
): VoiceProfileRow {
  return {
    userId: "u1",
    tenantId: "local",
    xUsername: null,
    xUserId: null,
    status: "empty",
    replyCount: 0,
    conversationCount: 0,
    cardJson: null,
    cardModel: null,
    cardUpdatedAt: null,
    sinceId: null,
    lastPullAt: null,
    lastError: null,
    ...overrides,
  };
}

describe("shouldPullXApi", () => {
  it("skips the timeline when memories already unlock", () => {
    assert.equal(
      shouldPullXApi({ postCount: 107, handle: "margin" }),
      false,
    );
  });

  it("skips the timeline when there is no handle", () => {
    assert.equal(
      shouldPullXApi({ postCount: 40, handle: null }),
      false,
    );
  });

  it("pulls only to fill a short corpus", () => {
    assert.equal(
      shouldPullXApi({ postCount: 40, handle: "margin" }),
      true,
    );
  });
});

describe("deriveVoiceUiStatus", () => {
  it("is unlinked only with no corpus and no handle", () => {
    assert.equal(deriveVoiceUiStatus(null, null), "unlinked");
    assert.equal(deriveVoiceUiStatus(profile(), null), "unlinked");
  });

  it("treats memory corpus without a handle as insufficient, not unlinked", () => {
    assert.equal(
      deriveVoiceUiStatus(profile({ replyCount: 40 }), null),
      "insufficient",
    );
  });

  it("is empty when memories already unlock but the card is not written", () => {
    assert.equal(
      deriveVoiceUiStatus(profile({ replyCount: 107 }), null),
      "empty",
    );
  });

  it("stays ready when a card exists", () => {
    assert.equal(
      deriveVoiceUiStatus(
        profile({
          status: "ready",
          cardJson: '{"tone":"dry"}',
          replyCount: 107,
          conversationCount: 107,
        }),
        null,
      ),
      "ready",
    );
  });
});

describe("deriveNeedsLearn", () => {
  it("never arms a client learn — ingest is onboarding + hourly only", () => {
    assert.equal(
      deriveNeedsLearn({
        status: "empty",
        handle: "margin",
        profile: profile(),
        needsDailyUpdate: true,
      }),
      false,
    );
    assert.equal(
      deriveNeedsLearn({
        status: "insufficient",
        handle: "margin",
        profile: profile({ conversationCount: 40 }),
        needsDailyUpdate: false,
      }),
      false,
    );
  });
});

describe("POST /api/voice/learn", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "voice-learn-"));
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

  it("rejects client-triggered learn with a 403", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-learn",
      email: "voice@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const req = {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    let status = 0;
    let body = "";
    const res = {
      writeHead: (code: number) => {
        status = code;
      },
      end: (chunk: string) => {
        body = chunk;
      },
    } as unknown as ServerResponse;
    const handled = await tryHandleVoice(
      req,
      res,
      new URL("http://localhost/api/voice/learn"),
    );
    assert.equal(handled, true);
    assert.equal(status, 403);
    const json = JSON.parse(body) as { error?: string };
    assert.equal(json.error, "ingest_not_user_triggered");
  });
});

describe("POST /api/voice/stances", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "voice-stances-"));
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

  function seedReadyUser(email: string) {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${email}`,
      email,
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    const at = new Date().toISOString();
    getPlatformDb()
      .prepare(
        `INSERT INTO voice_profiles
           (user_id, tenant_id, status, reply_count, card_json, created_at, updated_at)
         VALUES (?, ?, 'ready', 100, '{"tone":"dry"}', ?, ?)`,
      )
      .run(user.id, tenantId, at, at);
    const billing = ensureUserBillingRow(user.id, tenantId);
    const planKey = effectivePlanKey(billing, user.email);
    return { user, tenantId, planKey };
  }

  async function postStances(
    user: AuthUser,
    body: Record<string, unknown>,
    chat?: ChatFn,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const { token } = createSession(user.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
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

    const handledPromise = tryHandleVoice(
      req,
      res,
      new URL("http://localhost/api/voice/stances"),
      chat,
    );
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
    (req as EventEmitter).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: JSON.parse(raw || "{}") as Record<string, unknown> };
  }

  it("returns needed:true on a fact-add without spending a suggest slot", async () => {
    const { user, planKey } = seedReadyUser("stance@example.com");
    const before = getSuggestUsage(user.id, planKey);
    const chat: ChatFn = async () => ({
      ok: true,
      content: '{"options":["Ship notes matter","The version is the story"]}',
      model: "deepseek-v4-flash",
      provider: "deepseek",
    });

    const { status, json } = await postStances(
      user,
      {
        author: "@dev",
        text: "sqlite 3.46 shipped today",
        threadKind: "fact_add",
      },
      chat,
    );

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.needed, true);
    assert.deepEqual(json.options, [
      "Ship notes matter",
      "The version is the story",
    ]);
    assert.deepEqual(getSuggestUsage(user.id, planKey), before);
  });

  it("rate-limits the 21st stance lookup in a minute, on any thread kind", async () => {
    const { user } = seedReadyUser("stance-rate@example.com");
    let chatCalls = 0;
    const chat: ChatFn = async () => {
      chatCalls += 1;
      return {
        ok: true,
        content:
          '{"options":["The loop is the tax","The tool still matters","Ask what they measure"]}',
        model: "deepseek-v4-flash",
        provider: "deepseek",
      };
    };
    for (let i = 0; i < 20; i++) {
      const { status, json } = await postStances(
        user,
        {
          author: "@dev",
          text: "the tool is never the bottleneck",
          threadKind: "sharp_opinion",
        },
        chat,
      );
      assert.equal(status, 200);
      assert.equal(json.needed, true);
    }
    assert.equal(chatCalls, 20);

    const { status, json } = await postStances(
      user,
      {
        author: "@dev",
        text: "sqlite 3.46 shipped today",
        threadKind: "fact_add",
      },
      chat,
    );

    assert.equal(status, 429);
    assert.equal(json.error, "rate_limited");
  });

  it("does not spend a suggest slot on a stance lookup — the draft charges", async () => {
    const { user, planKey } = seedReadyUser("stance-count@example.com");
    const before = getSuggestUsage(user.id, planKey).used;

    const { status } = await postStances(
      user,
      {
        author: "@dev",
        text: "the tool is never the bottleneck",
        threadKind: "sharp_opinion",
      },
      async () => ({
        ok: true,
        content: '{"options":["The loop is the tax","The tool still matters"]}',
        model: "deepseek-v4-flash",
        provider: "deepseek",
      }),
    );

    assert.equal(status, 200);
    assert.equal(getSuggestUsage(user.id, planKey).used, before);
  });

  it("rejects an opinionated stance lookup when today's suggest cap is spent", async () => {
    const { user } = seedReadyUser("stance-cap@example.com");
    const at = new Date().toISOString();
    const stmt = getPlatformDb().prepare(
      `INSERT INTO voice_suggests (id, user_id, thread_id, at) VALUES (?, ?, NULL, ?)`,
    );
    for (let i = 0; i < PLAN_DAILY_SUGGESTS.free; i++) {
      stmt.run(`stance-cap-${i}`, user.id, at);
    }

    const { status, json } = await postStances(user, {
      author: "@dev",
      text: "the tool is never the bottleneck",
      threadKind: "sharp_opinion",
    });

    assert.equal(status, 429);
    assert.equal(json.error, "suggest_daily_limit");
  });

  it("surfaces a stance LLM failure as a 502 instead of masking it with generic sides", async () => {
    const { user } = seedReadyUser("stance-502@example.com");
    const { status, json } = await postStances(
      user,
      {
        author: "@dev",
        text: "the tool is never the bottleneck",
        threadKind: "sharp_opinion",
      },
      async () => ({
        ok: false as const,
        status: 500,
        error: "deepseek_http",
        message: "deepseek HTTP 500",
      }),
    );

    assert.equal(status, 502);
    assert.equal(json.error, "deepseek_http");
  });

  it("marks generic sides as fallback when the model finds no side", async () => {
    const { user } = seedReadyUser("stance-fallback@example.com");
    const { status, json } = await postStances(
      user,
      {
        author: "@dev",
        text: "just reporting a fix",
        threadKind: "sharp_opinion",
      },
      async () => ({
        ok: true,
        content: '{"options":[]}',
        model: "deepseek-v4-flash",
        provider: "deepseek" as const,
      }),
    );

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.needed, true);
    assert.equal(json.fallback, true);
  });
});

describe("POST /api/voice/suggest", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "voice-suggest-"));
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

  function seedReadyUser(email: string) {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${email}`,
      email,
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    const at = new Date().toISOString();
    getPlatformDb()
      .prepare(
        `INSERT INTO voice_profiles
           (user_id, tenant_id, status, reply_count, card_json, created_at, updated_at)
         VALUES (?, ?, 'ready', 100, '{"tone":"dry"}', ?, ?)`,
      )
      .run(user.id, tenantId, at, at);
    ensureUserBillingRow(user.id, tenantId);
    return user;
  }

  async function postSuggest(
    user: AuthUser,
    body: Record<string, unknown>,
    chat?: ChatFn,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const { token } = createSession(user.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
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
    const handledPromise = tryHandleVoice(
      req,
      res,
      new URL("http://localhost/api/voice/suggest"),
      chat,
    );
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
    (req as EventEmitter).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: JSON.parse(raw || "{}") as Record<string, unknown> };
  }

  it("passes a ~130-char typed side through to the draft prompt untruncated", async () => {
    const user = seedReadyUser("suggest-stance@example.com");
    const capture: { messages?: ChatMessage[] } = {};
    const stance = "Ship the sqlite migration now before the quarter-end freeze";
    const longStance = stance.padEnd(130, ".");
    const { status, json } = await postSuggest(
      user,
      {
        threadId: "1234567890",
        author: "@dev",
        text: "the tool is never the bottleneck",
        stance: longStance,
      },
      async (opts) => {
        capture.messages = opts.messages;
        return {
          ok: true,
          content: "The loop between research and shipping is the real tax.",
          model: "deepseek-v4-flash",
          provider: "deepseek",
        };
      },
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const userMsg = capture.messages?.find((m) => m.role === "user");
    assert.ok(userMsg);
    assert.match(userMsg.content, /Take this side/);
    assert.ok(userMsg.content.includes(longStance));
  });
});

describe("POST /api/voice/post", () => {
  let dir: string;
  let cwd: string;
  const prevKey = process.env.X_API_KEY;
  const prevSecret = process.env.X_API_SECRET;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "voice-post-"));
    cwd = process.cwd();
    process.chdir(dir);
    mkdirSync(join(dir, "data", "gamification"), { recursive: true });
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.X_API_KEY = "ck";
    process.env.X_API_SECRET = "cs";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevKey === undefined) delete process.env.X_API_KEY;
    else process.env.X_API_KEY = prevKey;
    if (prevSecret === undefined) delete process.env.X_API_SECRET;
    else process.env.X_API_SECRET = prevSecret;
    rmSync(dir, { recursive: true, force: true });
  });

  function seedPoster(email: string, withWrite: boolean) {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: `xid-${email}`,
      username: "alice",
      email,
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    const at = new Date().toISOString();
    getPlatformDb()
      .prepare(
        `INSERT INTO voice_profiles
           (user_id, tenant_id, status, reply_count, card_json, created_at, updated_at)
         VALUES (?, ?, 'ready', 100, '{"tone":"dry"}', ?, ?)`,
      )
      .run(user.id, tenantId, at, at);
    ensureUserBillingRow(user.id, tenantId);
    if (withWrite) {
      assert.equal(
        saveXWriteCreds(user.id, `xid-${email}`, { token: "at", secret: "as" }),
        true,
      );
    }
    return user;
  }

  async function postReply(
    user: AuthUser,
    body: Record<string, unknown>,
    chat?: ChatFn,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const { token } = createSession(user.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
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
    const handledPromise = tryHandleVoice(
      req,
      res,
      new URL("http://localhost/api/voice/post"),
      chat,
    );
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
    (req as EventEmitter).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: JSON.parse(raw || "{}") as Record<string, unknown> };
  }

  const draft = "The loop is the tax on shipping.";
  const edited =
    "The loop is the tax on shipping. I would still pick the tool if it cut the wait.";
  const body = {
    draft,
    edited,
    inReplyToId: "1234567890",
    threadId: "1234567890",
    author: "@dev",
    url: "https://x.com/dev/status/1234567890",
    text: "the tool is never the bottleneck",
  };

  it("posts as the user and auto-marks the thread", async () => {
    const user = seedPoster("post-ok@example.com", true);
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (input, init) => {
      assert.match(String(input), /\/2\/tweets$/);
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ data: { id: "888" } }), {
        status: 201,
      });
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(
        user,
        body,
        async () => ({
          ok: true,
          content: '{"ok":true,"reason":"That reads like you."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      const tweet = json.tweet as { id?: string; url?: string };
      assert.equal(tweet.id, "888");
      assert.equal(tweet.url, "https://x.com/alice/status/888");
      const interaction = json.interaction as { threadId?: string; replyId?: string };
      assert.equal(interaction.threadId, "1234567890");
      assert.equal(interaction.replyId, "888");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rejects a non-trivial edit the LLM verify does not pass", async () => {
    const user = seedPoster("post-verify@example.com", true);
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(
        user,
        body,
        async () => ({
          ok: true,
          content: '{"ok":false,"reason":"Still reads as the draft."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(status, 400);
      assert.equal(json.error, "verify_required");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("refuses to post without write tokens", async () => {
    const user = seedPoster("post-nowrite@example.com", false);
    const { status, json } = await postReply(user, body);
    assert.equal(status, 403);
    assert.equal(json.error, "x_write_required");
  });

  it("rejects a trivial edit before calling X", async () => {
    const user = seedPoster("post-trivial@example.com", true);
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(user, {
        ...body,
        edited: draft,
      });
      assert.equal(status, 400);
      assert.equal(json.error, "edit_required");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns 429 during the desk-post cooldown", async () => {
    const user = seedPoster("post-cool@example.com", true);
    recordDeskPost({
      userId: user.id,
      tweetId: "1",
      inReplyToId: "2",
    });
    const { status, json } = await postReply(user, body);
    assert.equal(status, 429);
    assert.equal(json.error, "cooldown");
  });

  it("consumes the idempotency key on an ambiguous X failure so a retry cannot duplicate the reply", async () => {
    const user = seedPoster("post-ambig@example.com", true);
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("socket hang up");
    }) as typeof fetch;
    const chat: ChatFn = async () => ({
      ok: true,
      content: '{"ok":true,"reason":"That reads like you."}',
      model: "deepseek-v4-flash",
      provider: "deepseek",
    });
    try {
      const first = await postReply(
        user,
        { ...body, requestKey: "rk-ambig" },
        chat,
      );
      assert.equal(first.status, 502);
      assert.equal(first.json.error, "network");

      const retry = await postReply(
        user,
        { ...body, requestKey: "rk-ambig" },
        chat,
      );
      assert.equal(calls, 1);
      assert.equal(retry.status, 409);
      assert.equal(retry.json.error, "outcome_unknown");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("replays an ambiguous-failure key as outcome_unknown instead of re-posting", async () => {
    const user = seedPoster("post-replay@example.com", true);
    recordDeskPost({
      userId: user.id,
      tweetId: "",
      inReplyToId: "1234567890",
      threadId: "1234567890",
      requestKey: "rk-replay",
      atIso: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("socket hang up");
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(
        user,
        { ...body, requestKey: "rk-replay" },
        async () => ({
          ok: true,
          content: '{"ok":true,"reason":"That reads like you."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(calls, 0);
      assert.equal(status, 409);
      assert.equal(json.error, "outcome_unknown");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("posts a For You original without in_reply_to and marks the card done", async () => {
    const user = seedPoster("compose-ok@example.com", true);
    const [row] = insertSuggestions({
      userId: user.id,
      tenantId: ensureUserTenant(user.id),
      drafts: [{ kind: "post", why: "900 views", draft: "Ship the recap." }],
    });
    assert.ok(row);
    let posted = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      posted = String(init?.body ?? "");
      return new Response(JSON.stringify({ data: { id: "901" } }), {
        status: 201,
      });
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(
        user,
        {
          mode: "compose",
          suggestionId: row.id,
          draft,
          edited,
        },
        async () => ({
          ok: true,
          content: '{"ok":true,"reason":"That reads like you."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(status, 200);
      assert.equal(json.ok, true);
      assert.deepEqual(JSON.parse(posted), { text: edited });
      assert.equal(json.interaction, undefined);
      assert.equal(listActiveSuggestions(user.id).length, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("quotes from the suggestion targetId and rejects a compose reply", async () => {
    const user = seedPoster("compose-quote@example.com", true);
    const tenantId = ensureUserTenant(user.id);
    const [quote] = insertSuggestions({
      userId: user.id,
      tenantId,
      drafts: [
        {
          kind: "quote",
          why: "the winner",
          draft: "still true",
          targetId: "555",
          targetUrl: "https://x.com/a/status/555",
        },
      ],
    });
    const [replyCard] = insertSuggestions({
      userId: user.id,
      tenantId,
      drafts: [
        {
          kind: "reply",
          why: "open thread",
          targetId: "777",
          targetUrl: "https://x.com/a/status/777",
        },
      ],
    });
    assert.ok(quote);
    assert.ok(replyCard);
    let posted = "";
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async (_input, init) => {
      posted = String(init?.body ?? "");
      return new Response(JSON.stringify({ data: { id: "902" } }), {
        status: 201,
      });
    }) as typeof fetch;
    const chat: ChatFn = async () => ({
      ok: true,
      content: '{"ok":true,"reason":"That reads like you."}',
      model: "deepseek-v4-flash",
      provider: "deepseek",
    });
    try {
      const ok = await postReply(
        user,
        { mode: "compose", suggestionId: quote.id, draft, edited },
        chat,
      );
      assert.equal(ok.status, 200);
      assert.deepEqual(JSON.parse(posted), {
        text: edited,
        quote_tweet_id: "555",
      });

      const forbidden = await postReply(
        user,
        {
          mode: "compose",
          suggestionId: quote.id,
          draft,
          edited,
          inReplyToId: "1234567890",
        },
        chat,
      );
      assert.equal(forbidden.status, 400);
      assert.equal(forbidden.json.error, "reply_forbidden");

      const replyKind = await postReply(
        user,
        { mode: "compose", suggestionId: replyCard.id, draft, edited },
        chat,
      );
      assert.equal(replyKind.status, 400);
      assert.equal(replyKind.json.error, "compose_kind");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rejects posting an expired For You suggestion", async () => {
    const user = seedPoster("compose-expired@example.com", true);
    const [row] = insertSuggestions({
      userId: user.id,
      tenantId: ensureUserTenant(user.id),
      nowMs: Date.now() - SUGGESTION_TTL_MS - 1000,
      drafts: [{ kind: "post", why: "old views", draft: "Ship the old recap." }],
    });
    assert.ok(row);
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(
        user,
        { mode: "compose", suggestionId: row.id, draft, edited },
        async () => ({
          ok: true,
          content: '{"ok":true,"reason":"That reads like you."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(status, 404);
      assert.equal(json.error, "not_found");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("rejects posting the stored digest draft verbatim", async () => {
    const user = seedPoster("compose-digest@example.com", true);
    const digestDraft = "Ship the recap.";
    const [row] = insertSuggestions({
      userId: user.id,
      tenantId: ensureUserTenant(user.id),
      drafts: [{ kind: "post", why: "900 views", draft: digestDraft }],
    });
    assert.ok(row);
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    try {
      // The client spoofs a different "draft" and posts the digest draft as
      // "edited" — the digest-draft gate must reject it before X.
      const { status, json } = await postReply(
        user,
        {
          mode: "compose",
          suggestionId: row.id,
          draft: "filler",
          edited: digestDraft,
        },
        async () => ({
          ok: true,
          content: '{"ok":true,"reason":"That reads like you."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(status, 400);
      assert.equal(json.error, "edit_required");
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("replays a completed For You desk post by key even after the card is marked done", async () => {
    const user = seedPoster("compose-replay@example.com", true);
    const [row] = insertSuggestions({
      userId: user.id,
      tenantId: ensureUserTenant(user.id),
      drafts: [{ kind: "post", why: "900 views", draft: "Ship the recap." }],
    });
    assert.ok(row);
    markSuggestion({ id: row.id, userId: user.id, status: "done" });
    recordDeskPost({
      userId: user.id,
      tweetId: "555",
      inReplyToId: "",
      threadId: row.id,
      requestKey: "rk-compose-replay",
    });
    let calls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 201 });
    }) as typeof fetch;
    try {
      const { status, json } = await postReply(
        user,
        {
          mode: "compose",
          suggestionId: row.id,
          draft,
          edited,
          requestKey: "rk-compose-replay",
        },
        async () => ({
          ok: true,
          content: '{"ok":true,"reason":"That reads like you."}',
          model: "deepseek-v4-flash",
          provider: "deepseek" as const,
        }),
      );
      assert.equal(calls, 0);
      assert.equal(status, 200);
      assert.equal((json.tweet as { id?: string })?.id, "555");
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
