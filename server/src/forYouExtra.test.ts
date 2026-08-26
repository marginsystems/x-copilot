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
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { ensureUserTenant } from "./billingStore.ts";
import {
  countExtraBatchesToday,
  FOR_YOU_EXTRA_DAILY_BATCHES,
  getExtraUsage,
  removeExtraRecord,
  reserveExtraSlot,
} from "./forYouExtra.ts";

describe("forYouExtra", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fyextra-"));
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

  it("reserves up to the UTC-day cap then refuses", () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-extra",
      email: "extra@example.com",
      emailVerified: true,
    });
    const tenantId = ensureUserTenant(user.id);
    const ids: string[] = [];
    for (let i = 0; i < FOR_YOU_EXTRA_DAILY_BATCHES; i++) {
      const id = reserveExtraSlot(user.id, tenantId);
      assert.ok(id);
      ids.push(id);
    }
    assert.equal(countExtraBatchesToday(user.id), FOR_YOU_EXTRA_DAILY_BATCHES);
    assert.equal(reserveExtraSlot(user.id, tenantId), null);
    const usage = getExtraUsage({
      userId: user.id,
      tenantId,
      planKey: "free",
    });
    assert.equal(usage.used, 10);
    assert.equal(usage.remaining, 0);
    assert.equal(usage.canExtra, false);
    removeExtraRecord(ids[0]!);
    assert.equal(countExtraBatchesToday(user.id), 9);
    assert.ok(reserveExtraSlot(user.id, tenantId));
  });
});
