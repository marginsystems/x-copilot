import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import {
  getDigestEmailSettings,
  setDigestEmailOptIn,
} from "./digestEmailStore.ts";
import {
  makeUnsubscribeToken,
  sendApproachDigestEmail,
  verifyUnsubscribeToken,
} from "./mail.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import type { ForYouSuggestion } from "./forYouStore.ts";

const NOW = Date.parse("2026-08-25T02:00:00.000Z");
const ENV = {
  RESEND_API_KEY: "re_test_secret",
  MAIL_FROM: "x-copilot <hello@info.xcopilot.dev>",
  MAIL_REPLY_TO: "contact@mergestorm.ai",
} as NodeJS.ProcessEnv;

function suggestion(userId: string, id: string): ForYouSuggestion {
  return {
    id,
    userId,
    tenantId: "local",
    kind: "post",
    status: "suggested",
    why: "Your top post reached 400 views",
    draft: "Share the lesson.",
    targetId: null,
    targetUrl: null,
    targetAuthor: null,
    createdAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 86_400_000).toISOString(),
    actedAt: null,
    origin: "daily",
  };
}

describe("Approach digest mail", () => {
  let dir: string;
  let userId: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-mail-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    userId = upsertOauthUser({
      provider: "google",
      providerUserId: "mail-google",
      email: "reader@example.com",
      emailVerified: true,
      displayName: "Reader",
    }).id;
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("defaults off and signs tamper-resistant unsubscribe tokens", () => {
    assert.equal(getDigestEmailSettings(userId)?.optedIn, false);
    const token = makeUnsubscribeToken(userId, ENV);
    assert.ok(token);
    assert.equal(verifyUnsubscribeToken(token, ENV), userId);
    assert.equal(verifyUnsubscribeToken(`${token}x`, ENV), null);
  });

  it("sends only after opt-in and records once-per-UTC-day delivery", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ id: "email-1" }), { status: 200 });
    };
    const before = await sendApproachDigestEmail({
      userId,
      suggestions: [suggestion(userId, "s1")],
      nowMs: NOW,
      env: ENV,
      fetchImpl,
    });
    assert.equal(before.reason, "not_opted_in");
    assert.equal(calls.length, 0);

    assert.equal(setDigestEmailOptIn(userId, true, NOW)?.optedIn, true);
    const sent = await sendApproachDigestEmail({
      userId,
      suggestions: [suggestion(userId, "s1")],
      nowMs: NOW,
      env: ENV,
      fetchImpl,
    });
    assert.deepEqual(sent, { sent: true, reason: "sent" });
    assert.equal(calls.length, 1);
    const body = JSON.parse(String(calls[0].init?.body)) as Record<string, unknown>;
    assert.equal(body.from, ENV.MAIL_FROM);
    assert.deepEqual(body.to, ["reader@example.com"]);
    assert.equal(body.reply_to, ENV.MAIL_REPLY_TO);
    assert.match(String(body.text), /400 views/);
    assert.doesNotMatch(String(body.text), /Share the lesson/);
    assert.match(String(body.text), /Built by Mergestorm/);

    const again = await sendApproachDigestEmail({
      userId,
      suggestions: [suggestion(userId, "s2")],
      nowMs: NOW + 3_600_000,
      env: ENV,
      fetchImpl,
    });
    assert.equal(again.reason, "already_sent");
    assert.equal(calls.length, 1);
  });

  it("soft-fails provider errors without marking delivery", async () => {
    setDigestEmailOptIn(userId, true, NOW);
    const failed = await sendApproachDigestEmail({
      userId,
      suggestions: [suggestion(userId, "s1")],
      nowMs: NOW,
      env: ENV,
      fetchImpl: async () => new Response("no", { status: 503 }),
    });
    assert.equal(failed.reason, "provider_error");
    assert.equal(getDigestEmailSettings(userId)?.sentAt, null);
  });
});
