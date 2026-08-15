import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { upsertOauthUser } from "./authStore.ts";
import {
  ensureUserTenant,
  sortiesExhaustedResponse,
} from "./billingStore.ts";
import { getSortieUsage, recordSortie } from "./scoutSorties.ts";

describe("scout sorties", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-sortie-"));
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

  it("grounds Free after one Take off today", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-sortie-1",
      email: "fly@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    assert.equal(getSortieUsage(tenantId, "free").canFly, true);
    recordSortie(tenantId);
    const usage = getSortieUsage(tenantId, "free");
    assert.equal(usage.used, 1);
    assert.equal(usage.limit, 1);
    assert.equal(usage.canFly, false);
    const blocked = sortiesExhaustedResponse({
      userId: user.id,
      tenantId,
      email: user.email,
    });
    assert.ok(blocked);
    assert.equal(blocked?.error, "scout_daily_limit");
  });

  it("lets Pulse take off five times", () => {
    const tenantId = "local";
    recordSortie(tenantId);
    recordSortie(tenantId);
    recordSortie(tenantId);
    recordSortie(tenantId);
    assert.equal(getSortieUsage(tenantId, "pulse").remaining, 1);
    recordSortie(tenantId);
    assert.equal(getSortieUsage(tenantId, "pulse").canFly, false);
  });
});
