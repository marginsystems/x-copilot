/**
 * C13: GET /api/scout/profile serves only the session user's familiarity,
 * keeps the boot auth policy, is never public-allowlisted, and marks every
 * handler response private/no-store.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isPublicApiPath } from "../auth/authGuard.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { recordScoutEvidence, takeEventKey } from "./scoutEvidence.ts";
import { emptyScoutProfile, type ScoutProfile } from "./scoutProfile.ts";
import { readScoutProfile } from "./scoutProfileStore.ts";
import { tryHandleScoutProfile, type ScoutProfileHttpDeps } from "./scoutProfileHttp.ts";

type Reply = {
  handled: boolean;
  status: number;
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
};

async function request(
  path: string,
  opts: { method?: string; cookie?: string; deps?: ScoutProfileHttpDeps; body?: string } = {},
): Promise<Reply> {
  let status = 0;
  let headers: Record<string, unknown> = {};
  let raw = "";
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: opts.method ?? "GET",
    headers: opts.cookie ? { cookie: opts.cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  const res = {
    writeHead: (code: number, h: Record<string, unknown>) => {
      status = code;
      headers = h;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handled = await tryHandleScoutProfile(
    req,
    res,
    new URL(`http://localhost${path}`),
    opts.deps,
  );
  return {
    handled,
    status,
    headers,
    body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

function cookieFor(userId: string): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(createSession(userId).token)}`;
}

function spy(backing: (userId: string) => ScoutProfile | null | undefined | Promise<ScoutProfile>) {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      loadScoutProfile: async (userId: string) => {
        calls.push(userId);
        return backing(userId);
      },
    } satisfies ScoutProfileHttpDeps,
  };
}

const T0 = Date.parse("2026-09-20T10:00:00.000Z");

function storedTake(userId: string, n: number): void {
  recordScoutEvidence({
    userId,
    eventKey: takeEventKey(`r-${userId}-${n}`),
    action: "take",
    source: "manual",
    targetId: `t-${userId}-${n}`,
    replyId: `r-${userId}-${n}`,
    actedAt: new Date(T0 + n * 1000).toISOString(),
    threadKind: "fact_add",
    noteState: "stored",
    nowMs: T0 + n * 1000,
  });
}

describe("GET /api/scout/profile", () => {
  const prevAuth = process.env.AUTH_REQUIRED;
  let temp: TempPlatformDb;
  let profileDir: string;

  beforeEach(() => {
    temp = openTempPlatformDb("x-scout-profile-http-");
    profileDir = mkdtempSync(join(tmpdir(), "x-scout-profile-http-dir-"));
    process.env.AUTH_REQUIRED = "1";
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
    rmSync(profileDir, { recursive: true, force: true });
    if (prevAuth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuth;
  });

  function user(tag: string) {
    return upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${tag}`,
      email: `${tag}@example.com`,
      emailVerified: true,
    });
  }

  function realStore(): ScoutProfileHttpDeps {
    return {
      loadScoutProfile: (id) => readScoutProfile(id, { profileDir, reconcile: false }),
    };
  }

  it("is not on the public path allowlist", () => {
    assert.equal(isPublicApiPath("/api/scout/profile"), false);
    assert.equal(isPublicApiPath("/api/boot"), true);
  });

  it("ignores unrelated paths and non-GET methods", async () => {
    const loader = spy(() => emptyScoutProfile("x"));
    const u = user("method");
    for (const path of ["/api/scout/profiles", "/api/scout/last", "/api/scout", "/api/profile"]) {
      const reply = await request(path, { cookie: cookieFor(u.id), deps: loader.deps });
      assert.equal(reply.handled, false, path);
      assert.equal(reply.status, 0);
    }
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      const reply = await request("/api/scout/profile", {
        method,
        cookie: cookieFor(u.id),
        deps: loader.deps,
      });
      assert.equal(reply.handled, false, method);
    }
    assert.deepEqual(loader.calls, []);
  });

  it("returns the existing 401 without a session when auth is required, reading nothing", async () => {
    const loader = spy(() => emptyScoutProfile("x"));
    const reply = await request("/api/scout/profile", { deps: loader.deps });
    assert.equal(reply.handled, true);
    assert.equal(reply.status, 401);
    assert.deepEqual(reply.body, { ok: false, error: "unauthenticated", authRequired: true });
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(loader.calls, []);
  });

  it("returns 200 with null and zero reads for an anonymous optional-auth request", async () => {
    process.env.AUTH_REQUIRED = "0";
    const loader = spy(() => emptyScoutProfile("x"));
    const reply = await request("/api/scout/profile?userId=someone", { deps: loader.deps });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { ok: true, scoutFamiliarity: null });
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(loader.calls, []);
  });

  it("serves the session user's projection with one loader call and the envelope only", async () => {
    const u = user("owner");
    const loader = spy((id) => ({ ...emptyScoutProfile(id), revision: 3 }));
    const reply = await request("/api/scout/profile", {
      cookie: cookieFor(u.id),
      deps: loader.deps,
    });
    assert.equal(reply.status, 200);
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(Object.keys(reply.body).sort(), ["ok", "scoutFamiliarity"]);
    assert.deepEqual(reply.body.scoutFamiliarity, {
      state: "empty",
      version: 1,
      revision: 3,
      score: 0,
      coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 0 },
      biases: [],
      hints: [],
      lastLearned: null,
      updatedAt: null,
    });
    assert.deepEqual(loader.calls, [u.id]);
  });

  it("resolves the owner from the session only; query selectors are ignored", async () => {
    const a = user("spoof-a");
    const b = user("spoof-b");
    const loader = spy((id) => emptyScoutProfile(id));
    const reply = await request(
      `/api/scout/profile?userId=${encodeURIComponent(b.id)}&user=${encodeURIComponent(b.id)}&tenant=other`,
      { cookie: cookieFor(a.id), deps: loader.deps },
    );
    assert.equal(reply.status, 200);
    assert.ok(reply.body.scoutFamiliarity);
    assert.deepEqual(loader.calls, [a.id]);
  });

  it("two session users sharing a tenant only ever see their own evidence", async () => {
    const a = user("tenant-a");
    const b = user("tenant-b");
    // Same tenant row for both desks; ownership is still per user id.
    const tenantId = ensureUserTenant(a.id);
    assert.ok(tenantId);
    storedTake(a.id, 1);
    storedTake(a.id, 2);
    storedTake(b.id, 1);

    const forA = await request("/api/scout/profile", {
      cookie: cookieFor(a.id),
      deps: realStore(),
    });
    const forB = await request("/api/scout/profile", {
      cookie: cookieFor(b.id),
      deps: realStore(),
    });
    const famA = forA.body.scoutFamiliarity as { coverage: { storedConfirmedReplies: number } };
    const famB = forB.body.scoutFamiliarity as { coverage: { storedConfirmedReplies: number } };
    assert.equal(famA.coverage.storedConfirmedReplies, 2);
    assert.equal(famB.coverage.storedConfirmedReplies, 1);
    assert.equal(JSON.stringify(forA.body).includes(a.id), false);
    assert.equal(JSON.stringify(forA.body).includes(b.id), false);
  });

  it("a foreign-owner, absent or thrown loader result is 200/null with the private header", async () => {
    const u = user("soft");
    const foreign = spy(() => emptyScoutProfile("someone-else"));
    let reply = await request("/api/scout/profile", { cookie: cookieFor(u.id), deps: foreign.deps });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { ok: true, scoutFamiliarity: null });
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(foreign.calls, [u.id]);

    const thrower = spy(() => {
      throw new Error("evidence db locked");
    });
    reply = await request("/api/scout/profile", { cookie: cookieFor(u.id), deps: thrower.deps });
    assert.equal(reply.status, 200);
    assert.deepEqual(reply.body, { ok: true, scoutFamiliarity: null });
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
    assert.deepEqual(thrower.calls, [u.id]);

    reply = await request("/api/scout/profile", {
      cookie: cookieFor(u.id),
      deps: spy(() => undefined).deps,
    });
    assert.deepEqual(reply.body, { ok: true, scoutFamiliarity: null });
  });

  it("repeated reads at the same evidence revision preserve revision and times", async () => {
    const u = user("stable");
    storedTake(u.id, 1);
    const first = await request("/api/scout/profile", { cookie: cookieFor(u.id), deps: realStore() });
    const second = await request("/api/scout/profile", { cookie: cookieFor(u.id), deps: realStore() });
    assert.deepEqual(second.body, first.body);
    const fam = first.body.scoutFamiliarity as { revision: number; updatedAt: string | null };
    assert.ok(fam.revision >= 1);
    assert.equal(typeof fam.updatedAt, "string");
  });
});
