import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hasStrings } from "../platform/unknownValue.js";
import { testRequest, testResponse, expectRecord, expectRecords } from "../http/http.testHelpers.ts";
import { tryHandleBoot, type BootHttpDeps } from "./bootHttp.ts";
import { recordScoutEvidence, takeEventKey } from "../scout/scoutEvidence.ts";
import { emptyScoutProfile } from "../scout/scoutProfile.ts";
import { flushScoutProfileProjections } from "../scout/scoutProfileProjection.ts";
import { readScoutProfile } from "../scout/scoutProfileStore.ts";
import { tryHandleScoutProfile } from "../scout/scoutProfileHttp.ts";
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
  deps?: BootHttpDeps,
): Promise<{
  handled: boolean;
  status: number;
  headers: Record<string, unknown>;
  body: Record<string, unknown>;
}> {
  const req = testRequest();
  Object.assign(req, {
    method: "GET",
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res, captured } = testResponse(req);
  const handled = await tryHandleBoot(
    req,
    res,
    new URL(`http://localhost${path}`),
    deps,
  );
  return {
    handled,
    status: captured.status,
    headers: captured.headers,
    body: captured.raw ? expectRecord(JSON.parse(captured.raw)) : {},
  };
}

async function getProfile(
  cookie: string,
  deps?: BootHttpDeps,
): Promise<Record<string, unknown>> {
  const req = testRequest();
  Object.assign(req, {
    method: "GET",
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res, captured } = testResponse(req);
  await tryHandleScoutProfile(
    req,
    res,
    new URL("http://localhost/api/scout/profile"),
    deps,
  );
  assert.equal(captured.status, 200);
  return captured.raw ? expectRecord(JSON.parse(captured.raw)) : {};
}

const EMPTY_FAMILIARITY = {
  state: "empty",
  version: 1,
  revision: 0,
  score: 0,
  coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 0 },
  biases: [],
  hints: [],
  lastLearned: null,
  updatedAt: null,
};

const DESK_SLICES = [
  "interacted",
  "dismissed",
  "skipped",
  "expired",
  "forYou",
  "lastScout",
  "gamification",
  "activityStats",
  "coaching",
];

async function getInteracted(
  cookie: string,
): Promise<Record<string, unknown>> {
  const req = testRequest();
  Object.assign(req, {
    method: "GET",
    headers: { cookie },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res, captured } = testResponse(req);
  await tryHandleInteracted(
    req,
    res,
    new URL("http://localhost/api/interacted"),
  );
  assert.equal(captured.status, 200);
  return captured.raw ? expectRecord(JSON.parse(captured.raw)) : {};
}

await describe("GET /api/boot", async () => {
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

  afterEach(async () => {
    // Evidence writes schedule projection rebuilds into this temp cwd; drain
    // them before the directory goes away.
    await flushScoutProfileProjections();
    resetInteractionMemoryReceiptForTests();
    resetPlatformDbForTests();
    process.chdir(cwd);
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    if (prevAuth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = prevAuth;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("ignores unrelated paths", async () => {
    const { handled, status } = await get("/api/health");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });

  await it("returns 401 without a session when auth is required", async () => {
    let reads = 0;
    const { handled, status, headers, body } = await get("/api/boot", undefined, {
      loadScoutProfile: (id) => {
        reads += 1;
        return emptyScoutProfile(id);
      },
    });
    assert.equal(handled, true);
    assert.equal(status, 401);
    assert.equal(body.ok, false);
    assert.equal(body.authRequired, true);
    assert.equal(headers["Cache-Control"], "private, no-store");
    assert.equal(reads, 0);
  });

  await it("anonymous optional-auth boot has null familiarity and performs no profile read", async () => {
    process.env.AUTH_REQUIRED = "0";
    let reads = 0;
    const { status, headers, body } = await get("/api/boot", undefined, {
      loadScoutProfile: (id) => {
        reads += 1;
        return emptyScoutProfile(id);
      },
    });
    assert.equal(status, 200);
    assert.equal(body.user, null);
    assert.equal(headers["Cache-Control"], "private, no-store");
    const desk = expectRecord(body.desk);
    assert.equal("scoutFamiliarity" in desk, true);
    assert.equal(desk.scoutFamiliarity, null);
    assert.equal(reads, 0);
  });

  await it("returns auth + desk slices in one payload", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot",
      email: "boot@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const { handled, status, headers, body } = await get(
      "/api/boot?dedupeAccounts=true",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal(headers["Cache-Control"], "private, no-store");
    assert.equal(body.ok, true);
    assert.equal(body.authRequired, true);
    const publicUser = expectRecord(body.user);
    assert.equal(publicUser.id, user.id);
    assert.equal(publicUser.email, "boot@example.com");
    const desk = expectRecord(body.desk);
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
    const lastScout = expectRecord(desk.lastScout);
    assert.equal(lastScout.ok, true);
    assert.equal(lastScout.empty, true);
    const coaching = expectRecord(desk.coaching);
    assert.equal(coaching.nextAction, null);
    assert.ok(Array.isArray(coaching.missions));
    assert.ok(coaching.missions.length >= 1);
    assert.equal(expectRecord(coaching.beats).forkChoice, null);
    const stats = expectRecord(desk.activityStats);
    assert.equal(stats.bucket, "day");
    // Default store path: a fresh user's familiarity is an honest empty object.
    assert.deepEqual(desk.scoutFamiliarity, EMPTY_FAMILIARITY);
    assert.equal(JSON.stringify(desk.scoutFamiliarity).includes(user.id), false);
  });

  await it("boot and GET /api/scout/profile agree at the same evidence revision", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-familiarity",
      email: "boot-familiarity@example.com",
      emailVerified: true,
    });
    const T0 = Date.parse("2026-09-20T10:00:00.000Z");
    for (let n = 1; n <= 2; n++) {
      recordScoutEvidence({
        userId: user.id,
        eventKey: takeEventKey(`r${n}`),
        action: "take",
        source: "manual",
        targetId: `t${n}`,
        replyId: `r${n}`,
        actedAt: new Date(T0 + n * 1000).toISOString(),
        threadKind: "fact_add",
        noteState: "stored",
        nowMs: T0 + n * 1000,
      });
    }
    const profileDir = join(dir, "profile-parity");
    const calls: string[] = [];
    const deps: BootHttpDeps = {
      loadScoutProfile: (id) => {
        calls.push(id);
        return readScoutProfile(id, { profileDir, reconcile: false });
      },
    };
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession(user.id).token)}`;
    const { status, body } = await get("/api/boot", cookie, deps);
    assert.equal(status, 200);
    const desk = expectRecord(body.desk);
    assert.deepEqual(calls, [user.id], "one loader call for the boot read");
    assert.equal(expectRecord(desk.scoutFamiliarity).state, "learning");
    assert.deepEqual(expectRecord(desk.scoutFamiliarity).coverage, {
      storedConfirmedReplies: 2,
      knownKindResolvedActions: 2,
    });
    assert.deepEqual(expectRecord(desk.scoutFamiliarity).lastLearned, {
      at: new Date(T0 + 2000).toISOString(),
      action: "take",
      threadKind: "fact_add",
    });

    const profile = await getProfile(cookie, deps);
    assert.deepEqual(calls, [user.id, user.id], "one loader call for the GET read");
    assert.deepEqual(profile.scoutFamiliarity, desk.scoutFamiliarity);
  });

  await it("an unreadable, foreign or absent profile keeps boot 200 with every other slice intact", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-boot-profile-fail",
      email: "boot-profile-fail@example.com",
      emailVerified: true,
    });
    await markInteracted({ threadId: "keep-1", author: "@keep", userId: user.id });
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSession(user.id).token)}`;
    const cases: Array<[string, BootHttpDeps["loadScoutProfile"]]> = [
      [
        "thrown read",
        () => {
          throw new Error("profile storage unusable");
        },
      ],
      ["rejected rebuild", () => Promise.reject(new Error("evidence db locked"))],
      ["foreign owner", () => emptyScoutProfile("someone-else")],
      ["absent", () => null],
      [
        "unusable",
        (id) => ({ ...emptyScoutProfile(id), familiarity: { state: "supported", score: 500 } }),
      ],
    ];
    for (const [label, loadScoutProfile] of cases) {
      const { status, headers, body } = await get("/api/boot", cookie, { loadScoutProfile });
      assert.equal(status, 200, label);
      assert.equal(body.ok, true, label);
      assert.equal(headers["Cache-Control"], "private, no-store", label);
      const desk = expectRecord(body.desk);
      assert.equal(desk.scoutFamiliarity, null, label);
      for (const slice of DESK_SLICES) {
        assert.ok(desk[slice] && typeof desk[slice] === "object", `${label}: ${slice}`);
      }
      const interacted = expectRecord(desk.interacted);
      assert.deepEqual(
        expectRecords(interacted.interactions).map((row) => row.threadId),
        ["keep-1"],
        label,
      );
      const gamification = expectRecord(desk.gamification);
      assert.ok("xp" in gamification || "level" in gamification, label);
    }
  });

  await it("does not expose another session user's interactions", async () => {
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
    const desk = expectRecord(body.desk);
    assert.deepEqual(
      expectRecords(expectRecord(desk.interacted).interactions).map((row) => row.threadId),
      ["thread-a"],
    );
    assert.deepEqual(expectRecord(desk.interacted).activeIds, ["thread-a"]);
  });

  await it("boot returns one page with retained totals and blocked ids", async () => {
    const user = upsertOauthUser({
      provider: "google", providerUserId: "boot-pages", email: "boot-pages@example.com", emailVerified: true,
    });
    for (let i = 0; i < 21; i++) {
      await markInteracted({ threadId: `boot-${i}`, author: "@pages", userId: user.id,
        conversationId: `root-${i}`, inReplyToId: `parent-${i}`, nowMs: Date.now() - 1000 + i });
    }
    const { token } = createSession(user.id);
    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    for (const [path, page, count] of [["/api/boot", 1, 10], ["/api/boot?page=3", 3, 1], ["/api/boot?page=4", 4, 0]] as const) {
      const { status, body } = await get(path, cookie);
      assert.equal(status, 200);
      const interacted = expectRecord(expectRecord(body.desk).interacted);
      assert.equal(interacted.page, page);
      assert.equal(interacted.pageSize, 10);
      assert.equal(interacted.total, 21);
      assert.equal(expectRecords(interacted.interactions).length, count);
      assert.ok(Array.isArray(interacted.activeIds));
      assert.equal(interacted.activeIds.length, 21);
      assert.ok(Array.isArray(interacted.blockedIds));
      assert.equal(interacted.blockedIds.length, 63);
      assert.ok(interacted.blockedIds.includes("root-0"));
      assert.ok(interacted.blockedIds.includes("parent-0"));
    }
  });

  await it("does not expose another user's skip, dismiss, expired, or tank", async () => {
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
    const desk = expectRecord(body.desk);
    assert.deepEqual(expectRecord(desk.skipped).skippedIds, ["skip-a"]);
    assert.deepEqual(expectRecord(desk.dismissed).dismissedIds, ["dismiss-a"]);
    assert.deepEqual(expectRecord(desk.expired).expiredIds, ["exp-a"]);
    assert.equal(expectRecord(desk.lastScout).empty, true);
    assert.equal("scoutLog" in desk, false);

    const { body: bodyB } = await get(
      "/api/boot",
      `${SESSION_COOKIE}=${encodeURIComponent(createSession(userB.id).token)}`,
    );
    const deskB = expectRecord(bodyB.desk);
    assert.deepEqual(expectRecord(deskB.skipped).skippedIds, ["skip-b"]);
    assert.equal(expectRecord(deskB.lastScout).empty, false);
    assert.deepEqual(
      expectRecords(expectRecord(expectRecord(deskB.lastScout).snapshot).threads).map((t) => t.id),
      ["tank-b"],
    );
  });

  await it("boot and GET history share saved, no-note, and wrong-owner receipts", async () => {
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
    const desk = expectRecord(body.desk);
    const bootById = Object.fromEntries(
      expectRecords(expectRecord(desk.interacted).interactions).map((row): [string, unknown] => {
        assert.equal(typeof row.threadId, "string");
        if (typeof row.threadId !== "string") assert.fail("Expected a thread id");
        return [row.threadId, row.memory];
      }),
    );
    assert.deepEqual(bootById["2081"], { state: "saved" });
    assert.deepEqual(bootById["2082"], { state: "no_reply_text" });
    assert.deepEqual(bootById["2083"], { state: "unavailable" });
    for (const row of expectRecords(expectRecord(desk.interacted).interactions)) {
      assert.equal("memoryPath" in expectRecord(row.memory ?? {}), false);
    }

    const history = await getInteracted(cookie);
    const getRows = expectRecords(history.interactions);
    assert.deepEqual(
      Object.fromEntries(getRows.map((row): [string, unknown] => {
        assert.equal(typeof row.threadId, "string");
        if (typeof row.threadId !== "string") assert.fail("Expected a thread id");
        return [row.threadId, row.memory];
      })),
      bootById,
    );
  });

  await it("missing memory storage does not fail boot", async () => {
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
    const desk = expectRecord(body.desk);
    assert.equal(expectRecord(expectRecords(expectRecord(desk.interacted).interactions)[0]?.memory).state, "unavailable");
  });

  await it("old boot callers still parse rows that include a memory receipt", async () => {
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
    const desk = expectRecord(body.desk);
    const interactions = expectRecord(desk.interacted).interactions;
    const rows = (Array.isArray(interactions) ? interactions : []).filter(
      (row) => hasStrings(row, "threadId", "author", "at"),
    );
    assert.deepEqual(
      rows.map((row) => row.threadId),
      ["legacy"],
    );
  });
});
