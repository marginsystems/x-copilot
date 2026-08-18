import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { createSession, upsertOauthUser } from "./authStore.ts";
import type { AuthUser } from "./authStore.ts";
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
    );
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
    (req as EventEmitter).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: JSON.parse(raw || "{}") as Record<string, unknown> };
  }

  it("returns needed:false on a non-opinion post without spending a suggest slot", async () => {
    const { user, planKey } = seedReadyUser("stance@example.com");
    const before = getSuggestUsage(user.id, planKey);

    const { status, json } = await postStances(user, {
      author: "@dev",
      text: "sqlite 3.46 shipped today",
      threadKind: "fact_add",
    });

    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.needed, false);
    assert.deepEqual(getSuggestUsage(user.id, planKey), before);
  });

  it("does not burn the stance rate-limit window on a non-opinion post", async () => {
    const { user } = seedReadyUser("stance-rate@example.com");
    for (let i = 0; i < 20; i++) {
      await postStances(user, {
        author: "@dev",
        text: "the tool is never the bottleneck",
        threadKind: "sharp_opinion",
      });
    }

    const { status, json } = await postStances(user, {
      author: "@dev",
      text: "sqlite 3.46 shipped today",
      threadKind: "fact_add",
    });

    assert.equal(status, 200);
    assert.equal(json.needed, false);
  });

  it("counts an opinionated stance lookup toward the daily suggest cap", async () => {
    const { user, planKey } = seedReadyUser("stance-count@example.com");
    const before = getSuggestUsage(user.id, planKey).used;

    const { status } = await postStances(user, {
      author: "@dev",
      text: "the tool is never the bottleneck",
      threadKind: "sharp_opinion",
    });

    assert.equal(status, 200);
    assert.equal(getSuggestUsage(user.id, planKey).used, before + 1);
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
});
