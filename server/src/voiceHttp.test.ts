import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { createSession, upsertOauthUser } from "./authStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import {
  deriveNeedsLearn,
  deriveVoiceUiStatus,
  shouldPullXApi,
  tryHandleVoice,
} from "./voiceHttp.ts";
import type { VoiceProfileRow } from "./voiceStore.ts";

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
      shouldPullXApi({ conversationCount: 107, handle: "margin" }),
      false,
    );
  });

  it("skips the timeline when there is no handle", () => {
    assert.equal(
      shouldPullXApi({ conversationCount: 40, handle: null }),
      false,
    );
  });

  it("pulls only to fill a short corpus", () => {
    assert.equal(
      shouldPullXApi({ conversationCount: 40, handle: "margin" }),
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
      deriveVoiceUiStatus(profile({ conversationCount: 40 }), null),
      "insufficient",
    );
  });

  it("is empty when memories already unlock but the card is not written", () => {
    assert.equal(
      deriveVoiceUiStatus(profile({ conversationCount: 107 }), null),
      "empty",
    );
  });

  it("stays ready when a card exists", () => {
    assert.equal(
      deriveVoiceUiStatus(
        profile({
          status: "ready",
          cardJson: '{"tone":"dry"}',
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
