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
import {
  activateSubscription,
  ensureUserTenant,
  getUserBilling,
} from "./billingStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { tryHandleAdmin } from "./adminHttp.ts";

describe("POST /api/admin/grants", () => {
  let dir: string;
  const prevAdmin = process.env.ADMIN_EMAILS;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-admin-grant-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.ADMIN_EMAILS = "margin707@gmail.com";
    getPlatformDb();
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAdmin === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevAdmin;
    rmSync(dir, { recursive: true, force: true });
  });

  async function postGrant(
    cookieEmail: string,
    body: Record<string, unknown>,
    origin: string | null = "http://localhost:5173",
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const actor = upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${cookieEmail}`,
      email: cookieEmail,
      emailVerified: true,
    });
    const { token } = createSession(actor.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    const headers: Record<string, string> = {
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    };
    if (origin !== null) headers.origin = origin;
    Object.assign(req, {
      method: "POST",
      headers,
      socket: { remoteAddress: "127.0.0.1" },
      destroy: () => {},
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
    const handledPromise = tryHandleAdmin(
      req,
      res,
      new URL("http://localhost/api/admin/grants"),
    );
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
    (req as EventEmitter).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: JSON.parse(raw || "{}") as Record<string, unknown> };
  }

  it("lets an admin grant Pulse by X handle", async () => {
    upsertOauthUser({
      provider: "x",
      providerUserId: "xid-will",
      username: "willizuchukwu",
      email: "will@example.com",
      emailVerified: true,
    });
    const target = upsertOauthUser({
      provider: "x",
      providerUserId: "xid-will",
      username: "willizuchukwu",
      email: "will@example.com",
      emailVerified: true,
    });
    ensureUserTenant(target.id);
    const { status, json } = await postGrant("margin707@gmail.com", {
      handle: "willizuchukwu",
      plan: "pulse",
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.plan_key, "pulse");
    const grant = json.grant as { plan_key?: string; notice?: string };
    assert.equal(grant.plan_key, "pulse");
    assert.match(String(json.notice ?? grant.notice), /manually upgraded to Pulse/);
  });

  it("rejects an oversized grant body with 413", async () => {
    const { status, json } = await postGrant("margin707@gmail.com", {
      handle: "x".repeat(20_000),
      plan: "pulse",
    });
    assert.equal(status, 413);
    assert.equal(json.error, "bad_request");
    assert.match(String(json.message), /16 KiB/);
  });

  it("rejects a non-admin", async () => {
    const { status, json } = await postGrant("eve@example.com", {
      handle: "willizuchukwu",
      plan: "pulse",
    });
    assert.equal(status, 403);
    assert.equal(json.error, "forbidden");
  });

  it("rejects a grant request with no Origin header", async () => {
    upsertOauthUser({
      provider: "x",
      providerUserId: "xid-no-origin",
      username: "noorigin",
      email: "noorigin@example.com",
      emailVerified: true,
    });
    const { status, json } = await postGrant(
      "margin707@gmail.com",
      { handle: "noorigin", plan: "pulse" },
      null,
    );
    assert.equal(status, 403);
    assert.equal(json.error, "forbidden");
    assert.match(String(json.message), /Origin not allowed/);
  });

  it("reports a stored-but-inert grant when a live Stripe sub wins", async () => {
    const target = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-live-sub",
      email: "paid@example.com",
      emailVerified: true,
    });
    ensureUserTenant(target.id);
    activateSubscription({
      userId: target.id,
      planKey: "radar",
      stripeCustomerId: "cus_p",
      stripeSubscriptionId: "sub_p",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 1,
    });
    const { status, json } = await postGrant("margin707@gmail.com", {
      userId: target.id,
      plan: "pulse",
    });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.plan_key, "radar");
    assert.equal(json.grant, null);
    assert.equal(getUserBilling(target.id)?.grantPlanKey, "pulse");
    assert.match(String(json.notice), /is stored/);
  });

  it("does not claim Free when clearing a grant under a live Stripe sub", async () => {
    const target = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-clear-live",
      email: "clearlive@example.com",
      emailVerified: true,
    });
    ensureUserTenant(target.id);
    activateSubscription({
      userId: target.id,
      planKey: "radar",
      stripeCustomerId: "cus_c",
      stripeSubscriptionId: "sub_c",
      subscriptionStatus: "active",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 1,
    });
    const { status, json } = await postGrant("margin707@gmail.com", {
      userId: target.id,
      plan: "free",
    });
    assert.equal(status, 200);
    assert.equal(json.plan_key, "radar");
    assert.match(String(json.notice), /live Stripe subscription/);
    assert.doesNotMatch(String(json.notice), /back on Free/);
  });

  it("reports the grant as live when the target's Stripe sub is incomplete", async () => {
    const target = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-incomplete-sub",
      email: "incomplete@example.com",
      emailVerified: true,
    });
    ensureUserTenant(target.id);
    activateSubscription({
      userId: target.id,
      planKey: "pulse",
      stripeCustomerId: "cus_inc",
      stripeSubscriptionId: "sub_inc",
      subscriptionStatus: "incomplete",
      currentPeriodEnd: new Date().toISOString(),
      cancelAtPeriodEnd: false,
      stripeEventCreated: 1,
    });
    const { status, json } = await postGrant("margin707@gmail.com", {
      userId: target.id,
      plan: "pulse",
    });
    assert.equal(status, 200);
    assert.equal(json.plan_key, "pulse");
    const grant = json.grant as { plan_key?: string; notice?: string };
    assert.equal(grant.plan_key, "pulse");
    assert.match(String(grant.notice), /manually upgraded to Pulse/);
    assert.doesNotMatch(String(json.notice), /takes precedence/);
  });

  it("reports a stored-but-inert grant for an admin-email target", async () => {
    process.env.ADMIN_EMAILS = "margin707@gmail.com,ops2@example.com";
    const target = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-admin-target",
      email: "ops2@example.com",
      emailVerified: true,
    });
    ensureUserTenant(target.id);
    const { status, json } = await postGrant("margin707@gmail.com", {
      userId: target.id,
      plan: "pulse",
    });
    assert.equal(status, 200);
    assert.equal(json.plan_key, "horizon");
    assert.equal(json.grant, null);
    assert.equal(getUserBilling(target.id)?.grantPlanKey, "pulse");
    assert.match(String(json.notice), /admin accounts always run on/);
  });
});
