import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { upsertOauthUser } from "./authStore.ts";
import {
  applyVerifiedXUsername,
  verifyPublicXHandle,
} from "./xHandleVerify.ts";
import type { XUserLookupFail, XUserLookupOk } from "./xApi.ts";
import {
  ensureVoiceProfile,
  nowIso,
  updateVoiceProfilePull,
} from "./voiceStore.ts";

function okLookup(
  screenName: string,
  id = "1",
): () => Promise<XUserLookupOk> {
  return async () => ({
    ok: true,
    user: {
      id,
      screen_name: screenName,
      name: screenName,
      protected: false,
    },
  });
}

function failLookup(fail: XUserLookupFail): () => Promise<XUserLookupFail> {
  return async () => fail;
}

describe("verifyPublicXHandle", () => {
  it("rejects a missing or illegal handle without calling lookup", async () => {
    let called = 0;
    const lookup = async () => {
      called += 1;
      return failLookup({
        ok: false,
        status: 500,
        error: "unused",
      })();
    };
    const missing = await verifyPublicXHandle("", lookup);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error, "needs_x_handle");
    const bad = await verifyPublicXHandle("not a handle!!", lookup);
    assert.equal(bad.ok, false);
    assert.equal(called, 0);
  });

  it("returns the canonical screen_name and id from a successful lookup", async () => {
    const got = await verifyPublicXHandle("alice_dev", okLookup("Alice_Dev"));
    assert.deepEqual(got, { ok: true, handle: "Alice_Dev", id: "1" });
  });

  it("maps a missing X user to a 400", async () => {
    const got = await verifyPublicXHandle(
      "nobody",
      failLookup({
        ok: false,
        status: 404,
        error: "user_not_found",
        message: "No X account found for @nobody.",
      }),
    );
    assert.equal(got.ok, false);
    if (!got.ok) {
      assert.equal(got.status, 400);
      assert.equal(got.error, "x_user_not_found");
    }
  });
});

describe("applyVerifiedXUsername", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-handle-"));
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

  it("skips lookup when the handle is already set (any case)", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-prefill",
      emailVerified: false,
      username: "MarginSystems",
    });
    let called = 0;
    const lookup = async () => {
      called += 1;
      return okLookup("marginsystems")();
    };
    const got = await applyVerifiedXUsername({
      user,
      raw: "@marginsystems",
      lookup,
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.changed, false);
    assert.equal(got.user.xUsername, "MarginSystems");
    assert.equal(called, 0);
  });

  it("overwrites a Google user's handle after a verified lookup", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-edit",
      email: "g@example.com",
      emailVerified: true,
    });
    const got = await applyVerifiedXUsername({
      user,
      raw: "@alice_dev",
      lookup: okLookup("alice_dev"),
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.changed, true);
    assert.equal(got.user.xUsername, "alice_dev");
  });

  it("lets an X user change the prefilled handle", async () => {
    const user = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-change",
      emailVerified: false,
      username: "old_handle",
    });
    const got = await applyVerifiedXUsername({
      user,
      raw: "new_handle",
      lookup: okLookup("new_handle"),
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.changed, true);
    assert.equal(got.user.xUsername, "new_handle");
  });

  it("keeps the corpus and analytics when the new handle resolves to the same X account", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-same-account",
      email: "same@example.com",
      emailVerified: true,
    });
    const db = getPlatformDb();
    ensureVoiceProfile(user.id, "tenant-same");
    updateVoiceProfilePull({
      userId: user.id,
      xUsername: "alice",
      xUserId: "xid-alice",
    });
    db.prepare(
      `INSERT INTO own_posts (id, user_id, tenant_id, x_user_id, kind, text, posted_at, created_at)
       VALUES (?, ?, ?, ?, 'reply', 'hi', ?, ?)`,
    ).run("op-same", user.id, "tenant-same", "xid-alice", nowIso(), nowIso());
    const got = await applyVerifiedXUsername({
      user,
      raw: "alice2",
      lookup: okLookup("alice2", "xid-alice"),
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.changed, true);
    assert.equal(got.accountChanged, false);
    const posts = db
      .prepare(`SELECT COUNT(*) AS n FROM own_posts WHERE user_id = ?`)
      .get(user.id) as { n: number };
    assert.equal(Number(posts.n), 1);
  });

  it("prunes the previous account's corpus on a real account switch", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-switch",
      email: "sw@example.com",
      emailVerified: true,
    });
    const db = getPlatformDb();
    ensureVoiceProfile(user.id, "tenant-switch");
    updateVoiceProfilePull({
      userId: user.id,
      xUsername: "alice",
      xUserId: "xid-alice",
    });
    db.prepare(
      `INSERT INTO own_posts (id, user_id, tenant_id, x_user_id, kind, text, posted_at, created_at)
       VALUES (?, ?, ?, ?, 'reply', 'hi', ?, ?)`,
    ).run("op-switch", user.id, "tenant-switch", "xid-alice", nowIso(), nowIso());
    const got = await applyVerifiedXUsername({
      user,
      raw: "@acme",
      lookup: okLookup("acme", "xid-acme"),
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.changed, true);
    assert.equal(got.accountChanged, true);
    const posts = db
      .prepare(`SELECT COUNT(*) AS n FROM own_posts WHERE user_id = ?`)
      .get(user.id) as { n: number };
    assert.equal(Number(posts.n), 0);
  });
});
