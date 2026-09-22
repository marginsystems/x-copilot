import { testRequest } from "../http/http.testHelpers.js";
import { isRecord } from "../platform/unknownValue.js";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { type IncomingMessage, ServerResponse } from "node:http";
import { updateUserAgenda } from "../auth/authStore.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { defaultMigrationsDir, getPlatformDb, resetPlatformDbForTests } from "../db.ts";
import { markDismissed } from "../desk/dismissalStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { getRequestContext } from "../http/requestContext.ts";
import { getLastScout, saveScoutCache } from "./scoutCache.ts";
import { maybeStartEmptyTankScout } from "./scoutEmptyTank.ts";
import { peekScoutFlight, resetScoutGateForTests, tryBeginScout, SCOUT_COOLDOWN_MS } from "./scoutGate.ts";
import { readLastScoutPayload, tryHandleScout, type ScoutHttpDeps } from "./scoutHttp.ts";
import { countSortiesToday, recordSortie } from "./scoutSorties.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";

function assertEmpty(row: unknown) {
  assert.ok(isRecord(row));
  assert.equal(row.ok, true);
  assert.equal(row.empty, true);
}
const done = { agent: "scout", stage: "done", message: "done", at: new Date().toISOString() } as const;
const thread = {
  id: "lead", author: "@builder", text: "Shipped a tool",
  url: "https://x.com/builder/status/lead", createdAt: new Date().toISOString(),
  engage: "consider" as const, baitScore: 10, onAgenda: true,
};

await describe("empty-tank background Scout", async () => {
  let dir: string;
  let userId: string;
  let tenantId: string;
  let cookie: string;
  let calls: number;
  let deps: ScoutHttpDeps;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetScoutGateForTests();
    dir = mkdtempSync(join(process.cwd(), ".scout-empty-test-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    const user = upsertOauthUser({ provider: "x", providerUserId: "empty-pilot", username: "pilot", emailVerified: false });
    userId = user.id;
    updateUserAgenda(userId, "builders");
    tenantId = ensureUserTenant(userId);
    cookie = `${SESSION_COOKIE}=${createSession(userId).token}`;
    calls = 0;
    deps = {
      ensureMemoryIndex: async () => {},
      runScoutCollect: async () => {
        calls++;
        return { ok: true, event: done };
      },
    };
  });

  afterEach(async () => {
    await setImmediate();
    resetScoutGateForTests();
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  async function get() {
    let status = 0;
    let raw = "";
    const req = Object.assign(testRequest(), {
      method: "GET", headers: { cookie, origin: "http://localhost:5173" }, socket: { remoteAddress: "127.0.0.1" },
    });
    const res = Object.assign(new ServerResponse(testRequest()), {
      writeHead(code: number) { status = code; },
      end(chunk: string) { raw = chunk; },
    });
    assert.equal(await tryHandleScout(req, res, new URL("http://localhost/api/scout/last"), deps), true);
    assert.equal(status, 200);
    const result: unknown = JSON.parse(raw);
    assert.ok(isRecord(result));
    return result;
  }

  await it("returns empty while one collect is pending, then enforces cooldown", async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    deps.runScoutCollect = async (opts) => {
      calls++;
      assert.equal(opts.agenda, "builders");
      assert.deepEqual(opts.queries, []);
      assert.equal(opts.userId, userId);
      assert.ok(opts.sortieId);
      assert.deepEqual(getRequestContext(), { userId, tenantId });
      assert.equal(await opts.deps?.creditGate?.(), true);
      await pending;
      return { ok: true, event: done };
    };
    try {
      assertEmpty(await get());
      assert.equal(calls, 1);
      assert.equal(countSortiesToday(tenantId), 1);
      assertEmpty(await readLastScoutPayload({ userId, deps }));
      assertEmpty(await get());
      assert.equal(calls, 1);
    } finally {
      finish();
      await setImmediate();
    }
    assert.equal(countSortiesToday(tenantId), 0);
    assertEmpty(await get());
    assert.equal(calls, 1);
    assert.equal(tryBeginScout(userId, Date.now() + SCOUT_COOLDOWN_MS + 1).ok, true);
  });

  await it("does not start an empty-tank collect when autoStart is off", async () => {
    let status = 0;
    let raw = "";
    const req = Object.assign(testRequest(), {
      method: "GET",
      headers: { cookie, origin: "http://localhost:5173" },
      socket: { remoteAddress: "127.0.0.1" },
    });
    const res = Object.assign(new ServerResponse(testRequest()), {
      writeHead(code: number) { status = code; },
      end(chunk: string) { raw = chunk; },
    });
    assert.equal(
      await tryHandleScout(
        req,
        res,
        new URL("http://localhost/api/scout/last?autoStart=0"),
        deps,
      ),
      true,
    );
    assert.equal(status, 200);
    assertEmpty(JSON.parse(raw));
    await setImmediate();
    assert.equal(calls, 0);
  });

  await it("does not start an empty-tank collect without an Origin", async () => {
    let status = 0;
    const req = Object.assign(testRequest(), {
      method: "GET", headers: { cookie }, socket: { remoteAddress: "127.0.0.1" },
    });
    const res = Object.assign(new ServerResponse(testRequest()), {
      writeHead(code: number) { status = code; },
      end() {},
    });

    assert.equal(
      await tryHandleScout(req, res, new URL("http://localhost/api/scout/last"), deps),
      true,
    );
    assert.equal(status, 200);
    await setImmediate();
    assert.equal(calls, 0);
  });

  await it("starts from the shared reader after filtering, using the live agenda and snapshot filters", async () => {
    const filters = { excludedTags: ["political"], minViews: 200, filterByMinViews: true };
    await saveScoutCache({ savedAt: new Date().toISOString(), agenda: "old agenda", queries: ["old query"], filters, threads: [thread] }, { userId });
    await markDismissed({ userId, threadId: thread.id, author: thread.author });
    deps.runScoutCollect = async (opts) => {
      calls++;
      assert.equal(opts.agenda, "builders");
      assert.deepEqual(opts.filters, filters);
      await saveScoutCache({ savedAt: new Date().toISOString(), queries: [], threads: [] }, { userId });
      return { ok: true, event: { ...done, coolCount: 1 } };
    };
    assertEmpty(await readLastScoutPayload({ userId, deps }));
    await setImmediate();
    assert.equal(calls, 1);
    assert.deepEqual((await getLastScout({ userId }))?.filters, filters);
    assert.equal(countSortiesToday(tenantId), 1);
    const row = parseRowRow(getPlatformDb().prepare("SELECT delivered FROM scout_sorties WHERE tenant_id = ?").get(tenantId));
    assert.equal(row.delivered, 1);
  });

  await it("leaves two usable threads alone", async () => {
    await saveScoutCache({ savedAt: new Date().toISOString(), agenda: "builders", queries: [], threads: [thread, { ...thread, id: "second", author: "@second" }] }, { userId });
    await maybeStartEmptyTankScout(userId, deps);
    assert.equal((await get()).empty, false);
    assert.equal((await readLastScoutPayload({ userId, deps })).empty, false);
    assert.equal(calls, 0);
  });

  await it("starts once with one usable thread and still returns nonempty", async () => {
    await saveScoutCache({ savedAt: new Date().toISOString(), agenda: "builders", queries: [], threads: [thread] }, { userId });
    assert.equal((await get()).empty, false);
    assert.equal((await readLastScoutPayload({ userId, deps })).empty, false);
    await setImmediate();
    assert.equal(calls, 1);
  });

  await it("uses the filtered tank for the background start path", async () => {
    const dismissed = { ...thread, id: "dismissed", author: "@dismissed" };
    await saveScoutCache({ savedAt: new Date().toISOString(), agenda: "builders", queries: [], threads: [thread, dismissed] }, { userId });
    await markDismissed({ userId, threadId: dismissed.id, author: dismissed.author });
    await maybeStartEmptyTankScout(userId, deps);
    await setImmediate();
    assert.equal(calls, 1);
    const payload = await readLastScoutPayload({ userId, deps });
    assert.equal(payload.empty, false);
    assert.deepEqual(payload.snapshot?.threads, [{ ...thread, scoutAgendaSet: true }]);
    assert.equal(calls, 1);
  });

  for (const gate of ["session", "agenda", "unlinked", "credits", "sorties", "busy", "cooldown"] as const) {
    await it(`returns 200 empty without collect when blocked by ${gate}`, async () => {
      if (gate === "session") cookie = "";
      if (gate === "agenda") updateUserAgenda(userId, "   ");
      if (gate === "unlinked") {
        const user = upsertOauthUser({ provider: "google", providerUserId: "unlinked", email: "pilot@example.com", emailVerified: true });
        updateUserAgenda(user.id, "builders");
        cookie = `${SESSION_COOKIE}=${createSession(user.id).token}`;
      }
      if (gate === "credits") {
        getPlatformDb().prepare(`INSERT INTO x_api_usage_events (id, tenant_id, at, method, path, status, posts_read) VALUES ('spent', ?, ?, 'GET', '/2/tweets/search/recent', 200, 1000000000)`).run(tenantId, new Date().toISOString());
      }
      if (gate === "sorties") for (let i = 0; i < 100; i++) recordSortie(tenantId);
      if (gate === "busy") resetScoutGateForTests({ userId, active: true });
      if (gate === "cooldown") resetScoutGateForTests({ userId, lastFinishedAt: Date.now() });
      assertEmpty(await get());
      await setImmediate();
      assert.equal(calls, 0);
    });
  }

  await it("latches flight failure when the collect reports terminal_error", async () => {
    deps.runScoutCollect = async (opts) => {
      calls++;
      opts.onEvent?.({ ...done, stopReason: "terminal_error" });
      return { ok: true, event: { ...done, stopReason: "terminal_error" } };
    };
    assertEmpty(await get());
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(peekScoutFlight(userId).failure, true);
  });

  await it("does not latch flight failure on a clean target landing", async () => {
    deps.runScoutCollect = async (opts) => {
      calls++;
      opts.onEvent?.({ ...done, stopReason: "target" });
      return { ok: true, event: { ...done, stopReason: "target" } };
    };
    assertEmpty(await get());
    await setImmediate();
    assert.equal(calls, 1);
    assert.equal(peekScoutFlight(userId).failure, undefined);
  });

  for (const failure of ["memory", "collect"] as const) {
    await it(`contains ${failure} failure, refunds and releases the lock`, async () => {
      if (failure === "memory") deps.ensureMemoryIndex = async () => { throw new Error("test failure"); };
      else deps.runScoutCollect = async () => { calls++; throw new Error("test failure"); };
      assertEmpty(await get());
      await setImmediate();
      assert.equal(calls, failure === "memory" ? 0 : 1);
      assert.equal(countSortiesToday(tenantId), 0);
      assert.equal(tryBeginScout(userId, Date.now() + SCOUT_COOLDOWN_MS + 1).ok, true);
    });
  }
});

function parseRowRow(value: unknown): { delivered: number } {
  const valid = (row: unknown): row is { delivered: number } =>
    (isRecord(row) &&
    typeof row.delivered === "number");
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
