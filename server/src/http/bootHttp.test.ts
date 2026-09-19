import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tryHandleBoot } from "./bootHttp.ts";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { markDismissed } from "../desk/dismissalStore.ts";
import { markExpired } from "../desk/expiredStore.ts";
import { markInteracted } from "../desk/interactionStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { saveScoutCache } from "../scout/scoutCache.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { markSkipped } from "../desk/skipStore.ts";
import { resetInteractionMemoryReceiptForTests } from "../memory/interactionMemoryReceipt.ts";
import { writeInteractionMemory } from "../memory/knowledgeMemory.ts";
import { tryHandleInteracted } from "../desk/interactedHttp.ts";

async function get(
  path: string,
  cookie?: string,
): Promise<{ handled: boolean; status: number; body: Record<string, unknown> }> {
  let status = 0;
  let raw = "";
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  const handled = await tryHandleBoot(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  return {
    handled,
    status,
    body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

async function getInteracted(
  cookie: string,
): Promise<Record<string, unknown>> {
  let status = 0;
  let raw = "";
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method: "GET",
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const res = {
    writeHead: (code: number) => {
      status = code;
    },
    end: (chunk: string) => {
      raw = chunk;
    },
  } as unknown as ServerResponse;
  await tryHandleInteracted(
    req,
    res,
    new URL("http://localhost/api/interacted"),
  );
  assert.equal(status, 200);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

describe("GET /api/boot", () => {
  const prevAuth = process.env.AUTH_REQUIRED;
  let dir: string;
  let cwd: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-boot-http-"));
    cwd = process.cwd();
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.AUTH_REQUIRED = "1";
    resetInteractionMemoryReceiptForTests({
      knowledgeRoot: join(dir, "knowledge"),
    });
    process.chdir(dir);
    getPlatformDb();
  });

  afterEach(() => {
    resetInteractionMemoryReceiptForTests();
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAuth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuth;
    rmSync(dir, { recursive: true, force: true });
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await get("/api/health");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });

  it("returns 401 without a session when auth is required", async () => {
    const { handled, status, body } = await get("/api/boot");
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.authRequired, true);
  });

  it("returns auth + desk slices in one payload", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot",
      email: "boot@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { handled, status, body } = await get(
      "/api/boot?dedupeAccounts=true",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.authRequired, true);
    const publicUser = body.user as { id?: string; email?: string };
    assert.equal(publicUser.id, user.id);
    assert.equal(publicUser.email, "boot@example.com");
    const desk = body.desk as Record<string, unknown>;
    assert.ok(desk);
    assert.ok(desk.interacted && typeof desk.interacted === "object");
    assert.ok(desk.dismissed && typeof desk.dismissed === "object");
    assert.ok(desk.skipped && typeof desk.skipped === "object");
    assert.ok(desk.expired && typeof desk.expired === "object");
    assert.ok(desk.forYou && typeof desk.forYou === "object");
    assert.ok(desk.lastScout && typeof desk.lastScout === "object");
    assert.equal("scoutLog" in desk, false);
    assert.ok(desk.gamification && typeof desk.gamification === "object");
    assert.ok(desk.activityStats && typeof desk.activityStats === "object");
    assert.ok(desk.coaching && typeof desk.coaching === "object");
    const lastScout = desk.lastScout as { ok?: boolean; empty?: boolean };
    assert.equal(lastScout.ok, true);
    assert.equal(lastScout.empty, true);
    const coaching = desk.coaching as {
      nextAction?: unknown;
      missions?: unknown[];
      beats?: { forkChoice?: unknown };
    };
    assert.equal(coaching.nextAction, null);
    assert.ok(Array.isArray(coaching.missions));
    assert.ok(coaching.missions.length >= 1);
    assert.equal(coaching.beats?.forkChoice, null);
    const stats = desk.activityStats as { bucket?: string };
    assert.equal(stats.bucket, "day");
  });

  it("does not expose another session user's interactions", async () => {
    const userA = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-a",
      email: "boot-a@example.com",
      emailVerified: true,
    });
    const userB = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-b",
      email: "boot-b@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "thread-a",
      author: "@a",
      userId: userA.id,
    });
    await markInteracted({
      threadId: "thread-b",
      author: "@b",
      userId: userB.id,
    });
    const { token } = createSession(userA.id);

    const { status, body } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    const desk = body.desk as {
      interacted: {
        interactions: Array<{ threadId: string }>;
        activeIds: string[];
      };
    };
    assert.deepEqual(
      desk.interacted.interactions.map((row) => row.threadId),
      ["thread-a"],
    );
    assert.deepEqual(desk.interacted.activeIds, ["thread-a"]);
  });

  it("does not expose another user's skip, dismiss, expired, or tank", async () => {
    const userA = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-desk-a",
      email: "desk-a@example.com",
      emailVerified: true,
    });
    const userB = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-desk-b",
      email: "desk-b@example.com",
      emailVerified: true,
    });
    await markSkipped({ threadId: "skip-a", author: "@a", userId: userA.id });
    await markSkipped({ threadId: "skip-b", author: "@b", userId: userB.id });
    await markDismissed({
      threadId: "dismiss-a",
      author: "@a",
      userId: userA.id,
    });
    await markDismissed({
      threadId: "dismiss-b",
      author: "@b",
      userId: userB.id,
    });
    await markExpired({ threadId: "exp-a", author: "@a", userId: userA.id });
    await markExpired({ threadId: "exp-b", author: "@b", userId: userB.id });
    await saveScoutCache(
      {
        savedAt: new Date().toISOString(),
        agenda: "builders",
        queries: ["q"],
        threads: [
          {
            id: "tank-b",
            author: "@bravo",
            text: "b's lead",
            url: "https://x.com/bravo/status/tank-b",
            createdAt: new Date().toISOString(),
            engage: "consider",
            baitScore: 10,
            onAgenda: true,
          },
        ],
      },
      { userId: userB.id },
    );
    const { token } = createSession(userA.id);

    const { status, body } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(status, 200);
    const desk = body.desk as {
      skipped: { skippedIds: string[] };
      dismissed: { dismissedIds: string[] };
      expired: { expiredIds: string[] };
      lastScout: { empty?: boolean };
    };
    assert.deepEqual(desk.skipped.skippedIds, ["skip-a"]);
    assert.deepEqual(desk.dismissed.dismissedIds, ["dismiss-a"]);
    assert.deepEqual(desk.expired.expiredIds, ["exp-a"]);
    assert.equal(desk.lastScout.empty, true);
    assert.equal("scoutLog" in desk, false);

    const { body: bodyB } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(createSession(userB.id).token)}`,
    );
    const deskB = bodyB.desk as {
      skipped: { skippedIds: string[] };
      lastScout: { empty?: boolean; snapshot?: { threads: Array<{ id: string }> } };
    };
    assert.deepEqual(deskB.skipped.skippedIds, ["skip-b"]);
    assert.equal(deskB.lastScout.empty, false);
    assert.deepEqual(
      deskB.lastScout.snapshot?.threads.map((t) => t.id),
      ["tank-b"],
    );
  });

  it("boot and GET history share saved, no-note, and wrong-owner receipts", async () => {
    const knowledgeRoot = join(dir, "knowledge");
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-receipt",
      email: "boot-receipt@example.com",
      emailVerified: true,
    });
    const other = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-receipt-other",
      email: "boot-receipt-other@example.com",
      emailVerified: true,
    });
    const saved = await markInteracted({
      threadId: "2081",
      author: "@saved",
      userId: user.id,
    });
    await markInteracted({
      threadId: "2082",
      author: "@none",
      userId: user.id,
    });
    const stolen = await markInteracted({
      threadId: "2083",
      author: "@other",
      userId: user.id,
    });
    await writeInteractionMemory({
      threadId: "2081",
      author: "@saved",
      reply: "Owned confirmed reply.",
      userId: user.id,
      interactedAt: saved.at,
      knowledgeRoot,
    });
    await writeInteractionMemory({
      threadId: "2083",
      author: "@other",
      reply: "Written for another desk.",
      userId: other.id,
      interactedAt: stolen.at,
      knowledgeRoot,
    });
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession(user.id).token)}`;
    const { status, body } = await get("/api/boot", cookie);
    assert.equal(status, 200);
    const desk = body.desk as {
      interacted: {
        interactions: Array<{
          threadId: string;
          author: string;
          at: string;
          memory?: { state?: string; memoryPath?: string };
        }>;
      };
    };
    const bootById = Object.fromEntries(
      desk.interacted.interactions.map((row) => [row.threadId, row.memory]),
    );
    assert.deepEqual(bootById["2081"], { state: "saved" });
    assert.deepEqual(bootById["2082"], { state: "no_reply_text" });
    assert.deepEqual(bootById["2083"], { state: "unavailable" });
    for (const row of desk.interacted.interactions) {
      assert.equal("memoryPath" in (row.memory ?? {}), false);
    }

    const history = await getInteracted(cookie);
    const getRows = history.interactions as Array<{
      threadId: string;
      memory?: { state?: string };
    }>;
    assert.deepEqual(
      Object.fromEntries(getRows.map((row) => [row.threadId, row.memory])),
      bootById,
    );
  });

  it("missing memory storage does not fail boot", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-missing-store",
      email: "boot-missing@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "2088",
      author: "@gone",
      userId: user.id,
    });
    const { status, body } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(createSession(user.id).token)}`,
    );
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    const desk = body.desk as {
      interacted: { interactions: Array<{ memory?: { state?: string } }> };
    };
    assert.equal(desk.interacted.interactions[0]?.memory?.state, "unavailable");
  });

  it("old boot callers still parse rows that include a memory receipt", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-old-caller",
      email: "boot-old@example.com",
      emailVerified: true,
    });
    await markInteracted({
      threadId: "legacy",
      author: "@legacy",
      userId: user.id,
    });
    const { status, body } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(createSession(user.id).token)}`,
    );
    assert.equal(status, 200);
    const desk = body.desk as { interacted?: { interactions?: unknown } };
    const rows = (Array.isArray(desk.interacted?.interactions)
      ? desk.interacted.interactions
      : []
    ).filter((row) => {
      if (!row || typeof row !== "object") return false;
      const rec = row as { threadId?: unknown; author?: unknown; at?: unknown };
      return (
        typeof rec.threadId === "string" &&
        typeof rec.author === "string" &&
        typeof rec.at === "string"
      );
    });
    assert.deepEqual(
      rows.map((row) => (row as { threadId: string }).threadId),
      ["legacy"],
    );
  });
});
