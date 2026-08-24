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
  sortiesExhaustedResponse,
  suggestCapMessage,
  upgradeHint,
} from "./billingQuotas.ts";
import {
  getSortieUsage,
  recordSortie,
  refundSortie,
  sortieWasWasted,
} from "./scoutSorties.ts";

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
    assert.match(blocked?.message ?? "", /Pulse raises this/);
    assert.match(blocked?.message ?? "", /Usage & Billing/);
  });

  it("refunds a wasted takeoff so Free can fly again", () => {
    const tenantId = "local";
    const id = recordSortie(tenantId);
    assert.equal(getSortieUsage(tenantId, "free").canFly, false);
    assert.equal(refundSortie(id), true);
    assert.equal(getSortieUsage(tenantId, "free").canFly, true);
    assert.equal(refundSortie("missing"), false);
  });

  it("treats zero cools as wasted and keeps a sortie that found a thread", () => {
    assert.equal(sortieWasWasted({ ok: false, coolCount: 0 }), true);
    assert.equal(sortieWasWasted({ ok: true, coolCount: 0 }), true);
    assert.equal(sortieWasWasted({ ok: true, coolCount: 2 }), false);
    assert.equal(sortieWasWasted({ ok: false, coolCount: 1 }), false);
  });

  it("names the next plan on Grounded, credits, and suggest-cap copy", () => {
    assert.equal(upgradeHint("free"), "Pulse raises this — open Usage & Billing.");
    assert.equal(upgradeHint("horizon"), "Open Usage & Billing.");
    assert.match(suggestCapMessage("free", 10), /Pulse is 20\/day/);
    assert.match(suggestCapMessage("horizon", 40), /Open Usage & Billing/);
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
