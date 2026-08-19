import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getPlatformDb, resetPlatformDbForTests, defaultMigrationsDir } from "./db.ts";
import { setUserXUsername, upsertOauthUser } from "./authStore.ts";
import { xLinkRequiredResponse } from "./xLinkGate.ts";

describe("xLinkRequiredResponse", () => {
  let dir: string;
  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-link-gate-"));
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

  it("is null without a session or when X is linked", () => {
    assert.equal(xLinkRequiredResponse(null), null);
    const x = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-1",
      username: "alice",
      emailVerified: false,
    });
    assert.equal(xLinkRequiredResponse(x), null);
  });

  it("blocks a Google-only user even if they typed a handle", () => {
    const google = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-1",
      email: "alice@example.com",
      emailVerified: true,
      displayName: "Alice",
    });
    const typed = setUserXUsername(google.id, "typedhandle");
    assert.ok(typed);
    assert.equal(typed.xUsername, "typedhandle");
    assert.equal(xLinkRequiredResponse(typed)?.error, "x_link_required");
  });
});
