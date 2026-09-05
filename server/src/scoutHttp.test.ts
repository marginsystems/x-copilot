import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getLocalTenantId,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { markDismissed } from "./dismissalStore.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { saveScoutCache } from "./scoutCache.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import { getSortieUsage } from "./scoutSorties.ts";
import type { runScoutCollect } from "./scoutCollect.ts";
import type { runScoutSearch } from "./scoutRun.ts";
import { resetScoutGateForTests, tryBeginScout } from "./scoutGate.ts";
import {
  parseScoutFilters,
  readLastScoutPayload,
  tryHandleScout,
  type ScoutHttpDeps,
} from "./scoutHttp.ts";

type FakeState = {
  status: number;
  headers: Record<string, string>;
  chunks: string[];
};

/** X-linked platform user + session cookie (Scout requires both). */
function signInXUser(tag: string): { userId: string; cookie: string } {
  const user = upsertOauthUser({
    provider: "x",
    providerUserId: `xid-${tag}`,
    username: `pilot_${tag}`,
    emailVerified: false,
  });
  const { token } = createSession(user.id);
  return {
    userId: user.id,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
  };
}

/** Session cookie applied to every request in the current test. */
let currentCookie: string | undefined;

function makeReqRes(
  method: string,
  cookie: string | undefined = currentCookie,
): {
  req: IncomingMessage;
  res: ServerResponse;
  state: FakeState;
} {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: "127.0.0.1" },
  });
  const state: FakeState = { status: 0, headers: {}, chunks: [] };
  const res = {
    writableEnded: false,
    writeHead(code: number, headers?: Record<string, string>) {
      state.status = code;
      if (headers) Object.assign(state.headers, headers);
      return this;
    },
    write(chunk: unknown) {
      state.chunks.push(String(chunk));
      return true;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) state.chunks.push(String(chunk));
      this.writableEnded = true;
    },
  } as unknown as ServerResponse;
  return { req, res, state };
}

async function call(
  method: string,
  path: string,
  opts: {
    body?: unknown;
    rawBody?: string;
    deps?: ScoutHttpDeps;
    cookie?: string;
  } = {},
): Promise<{
  handled: boolean;
  state: FakeState;
  res: ServerResponse;
}> {
  const { req, res, state } = makeReqRes(method, opts.cookie);
  const handledPromise = tryHandleScout(
    req,
    res,
    new URL(`http://localhost${path}`),
    opts.deps,
  );
  const emitter = req as unknown as EventEmitter;
  if (opts.rawBody !== undefined) {
    emitter.emit("data", Buffer.from(opts.rawBody));
  } else if (opts.body !== undefined) {
    emitter.emit("data", Buffer.from(JSON.stringify(opts.body)));
  }
  emitter.emit("end");
  const handled = await handledPromise;
  return { handled, state, res };
}

function ndjsonLines(chunks: string[]): Array<Record<string, unknown>> {
  return chunks
    .join("")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

const doneEvent = {
  agent: "scout",
  stage: "done",
  message: "done",
  at: new Date().toISOString(),
} as const;

function okCollectStub(): typeof runScoutCollect {
  return (async (opts) => {
    opts.onEvent?.({
      agent: "scout",
      stage: "planning",
      message: "planning",
      at: new Date().toISOString(),
    });
    opts.onEvent?.({ ...doneEvent });
    return { ok: true, event: { ...doneEvent } };
  }) as typeof runScoutCollect;
}

const stubDeps = (): ScoutHttpDeps => ({
  runScoutCollect: okCollectStub(),
  ensureMemoryIndex: async () => {},
});

describe("parseScoutFilters", () => {
  it("returns undefined for missing or non-object input", () => {
    assert.equal(parseScoutFilters(undefined), undefined);
    assert.equal(parseScoutFilters(null), undefined);
    assert.equal(parseScoutFilters("x"), undefined);
    assert.equal(parseScoutFilters(42), undefined);
  });

  it("returns undefined for an empty object", () => {
    assert.equal(parseScoutFilters({}), undefined);
  });

  it("keeps maxThreadChars only when it is an integer", () => {
    assert.deepEqual(parseScoutFilters({ maxThreadChars: 1200 }), {
      maxThreadChars: 1200,
    });
    assert.equal(parseScoutFilters({ maxThreadChars: 1.5 }), undefined);
    assert.equal(parseScoutFilters({ maxThreadChars: "1200" }), undefined);
  });

  it("passes boolean flags through", () => {
    assert.deepEqual(
      parseScoutFilters({
        dropArticles: true,
        dropOutboundLinks: false,
        dropNativeMedia: false,
        dropHashtags: false,
        dropEmDashes: false,
        dropProfanity: false,
        dropAutomatedAccounts: true,
        dedupeAccounts: false,
        avoidPrompt: "  skip dunking  ",
      }),
      {
        dropArticles: true,
        dropOutboundLinks: false,
        dropNativeMedia: false,
        dropHashtags: false,
        dropEmDashes: false,
        dropProfanity: false,
        dropAutomatedAccounts: true,
        dedupeAccounts: false,
        avoidPrompt: "skip dunking",
      },
    );
  });

  it("trims and lowercases preferredLanguage, drops blank", () => {
    assert.deepEqual(parseScoutFilters({ preferredLanguage: "  EN " }), {
      preferredLanguage: "en",
    });
    assert.equal(parseScoutFilters({ preferredLanguage: "   " }), undefined);
  });

  it("preserves explicit empty exclude arrays", () => {
    assert.deepEqual(parseScoutFilters({ excludedTags: [] }), {
      excludedTags: [],
    });
    assert.deepEqual(parseScoutFilters({ excludedAccounts: [] }), {
      excludedAccounts: [],
    });
  });

  it("trims exclude entries and drops blanks and non-strings", () => {
    assert.deepEqual(
      parseScoutFilters({ excludedTags: [" a ", "", 1, "b"] }),
      { excludedTags: ["a", "b"] },
    );
    assert.deepEqual(parseScoutFilters({ excludedAccounts: [" @X ", " "] }), {
      excludedAccounts: ["@X"],
    });
  });
});

describe("tryHandleScout", () => {
  let dir: string;
  let pilot: { userId: string; cookie: string };

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-scout-http-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    resetScoutGateForTests();
    pilot = signInXUser("a");
    currentCookie = pilot.cookie;
  });

  afterEach(() => {
    currentCookie = undefined;
    resetPlatformDbForTests();
    resetScoutGateForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("streams NDJSON on POST /api/scout/run with a terminal done line", async () => {
    const { handled, state, res } = await call("POST", "/api/scout/run", {
      body: { queries: ["q1"], agenda: "find cool threads" },
      deps: stubDeps(),
    });
    assert.equal(handled, true);
    assert.equal(state.status, 200);
    assert.match(state.headers["Content-Type"], /application\/x-ndjson/);
    assert.equal(state.headers["Cache-Control"], "no-cache");
    const lines = ndjsonLines(state.chunks);
    assert.equal(lines[0]?.stage, "planning");
    assert.equal(lines.at(-1)?.stage, "done");
    assert.equal(res.writableEnded, true);
  });

  it("releases the scout lock after a run ends", async () => {
    await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps: stubDeps(),
    });
    // Cooldown is separate from the lock; reset it to prove `active` cleared.
    resetScoutGateForTests();
    assert.equal(tryBeginScout(pilot.userId).ok, true);
  });

  it("returns 401 on POST /api/scout/run and /api/search without a session", async () => {
    currentCookie = undefined;
    for (const path of ["/api/scout/run", "/api/search"]) {
      const { handled, state } = await call("POST", path, {
        body: { queries: ["q1"] },
        deps: stubDeps(),
      });
      assert.equal(handled, true, path);
      assert.equal(state.status, 401, path);
      const body = JSON.parse(state.chunks.join("")) as Record<string, unknown>;
      assert.equal(body.error, "unauthenticated", path);
    }
  });

  it("does not 429 user B while user A's Scout run is active", async () => {
    resetScoutGateForTests({ userId: pilot.userId, active: true });
    const busy = await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps: stubDeps(),
    });
    assert.equal(busy.state.status, 429);

    const other = signInXUser("b");
    const { handled, state } = await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps: stubDeps(),
      cookie: other.cookie,
    });
    assert.equal(handled, true);
    assert.equal(state.status, 200);
    assert.equal(ndjsonLines(state.chunks).at(-1)?.stage, "done");
  });

  it("GET /api/scout/last returns only the session user's tank", async () => {
    const other = signInXUser("b");
    const thread = (id: string, author: string) => ({
      id,
      author,
      text: `${author} shipped something`,
      url: `https://x.com/${author.slice(1)}/status/${id}`,
      createdAt: new Date().toISOString(),
      engage: "consider" as const,
      baitScore: 10,
      onAgenda: true,
    });
    await saveScoutCache(
      {
        savedAt: new Date().toISOString(),
        agenda: "builders",
        queries: ["q"],
        threads: [thread("a1", "@alpha"), thread("shared", "@both")],
      },
      { userId: pilot.userId },
    );
    await saveScoutCache(
      {
        savedAt: new Date().toISOString(),
        agenda: "builders",
        queries: ["q"],
        threads: [thread("b1", "@bravo"), thread("shared", "@both")],
      },
      { userId: other.userId },
    );
    // A dismisses the shared thread; B must still see it.
    await markDismissed({
      threadId: "shared",
      author: "@both",
      userId: pilot.userId,
    });

    const a = await readLastScoutPayload({ userId: pilot.userId });
    const b = await readLastScoutPayload({ userId: other.userId });
    assert.equal(a.empty, false);
    assert.equal(b.empty, false);
    assert.deepEqual(
      (a.snapshot?.threads as Array<{ id: string }>).map((t) => t.id),
      ["a1"],
    );
    assert.deepEqual(
      (b.snapshot?.threads as Array<{ id: string }>).map((t) => t.id).sort(),
      ["b1", "shared"],
    );
    assert.deepEqual(await readLastScoutPayload({ userId: undefined }), {
      ok: true,
      empty: true,
    });

    const { state } = await call("GET", "/api/scout/last", {
      cookie: other.cookie,
    });
    assert.equal(state.status, 200);
    const body = JSON.parse(state.chunks.join("")) as {
      snapshot?: { threads: Array<{ id: string }> };
    };
    assert.deepEqual(
      body.snapshot?.threads.map((t) => t.id).sort(),
      ["b1", "shared"],
    );
  });

  it("writes an error line when the collect fails without a terminal event", async () => {
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async () => ({
        ok: false,
        status: 500,
        error: "x_api",
        message: "boom",
      })) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    const { handled, state } = await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(handled, true);
    assert.match(state.headers["Content-Type"], /application\/x-ndjson/);
    const lines = ndjsonLines(state.chunks);
    assert.equal(lines.at(-1)?.stage, "error");
    assert.match(String(lines.at(-1)?.message), /boom/);
  });

  it("returns JSON 429 scout_busy before any NDJSON writeHead when locked", async () => {
    resetScoutGateForTests({ userId: pilot.userId, active: true });
    const { handled, state } = await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps: stubDeps(),
    });
    assert.equal(handled, true);
    assert.equal(state.status, 429);
    assert.equal(state.headers["Content-Type"], "application/json");
    const body = JSON.parse(state.chunks.join("")) as Record<string, unknown>;
    assert.equal(body.error, "scout_busy");
  });

  it("returns JSON 429 scout_busy on POST /api/search when locked", async () => {
    resetScoutGateForTests({ userId: pilot.userId, active: true });
    const { handled, state } = await call("POST", "/api/search", {
      body: { queries: ["q1"] },
    });
    assert.equal(handled, true);
    assert.equal(state.status, 429);
    const body = JSON.parse(state.chunks.join("")) as Record<string, unknown>;
    assert.equal(body.error, "scout_busy");
  });

  it("aborts an in-flight run when the client closes", async () => {
    let seenSignal: AbortSignal | undefined;
    let release: (value: {
      ok: true;
      event: Record<string, unknown>;
    }) => void = () => {};
    const pending = new Promise<{ ok: true; event: Record<string, unknown> }>(
      (resolve) => {
        release = resolve;
      },
    );
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async (opts) => {
        seenSignal = opts.signal;
        return pending;
      }) as unknown as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    const { req, res, state } = makeReqRes("POST");
    const emitter = req as unknown as EventEmitter;
    const handledPromise = tryHandleScout(
      req,
      res,
      new URL("http://localhost/api/scout/run"),
      deps,
    );
    emitter.emit("data", Buffer.from(JSON.stringify({ queries: ["q1"] })));
    emitter.emit("end");
    for (let i = 0; i < 100 && !seenSignal; i++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.ok(seenSignal);
    assert.equal(seenSignal.aborted, false);
    emitter.emit("close");
    assert.equal(seenSignal.aborted, true);
    release({ ok: true, event: { ...doneEvent } });
    assert.equal(await handledPromise, true);
    assert.match(state.headers["Content-Type"], /application\/x-ndjson/);
  });

  it("does not abort after a clean end when close fires", async () => {
    let seenSignal: AbortSignal | undefined;
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async (opts) => {
        seenSignal = opts.signal;
        opts.onEvent?.({ ...doneEvent });
        return { ok: true, event: { ...doneEvent } };
      }) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    const { req, res, state } = makeReqRes("POST");
    const emitter = req as unknown as EventEmitter;
    const handledPromise = tryHandleScout(
      req,
      res,
      new URL("http://localhost/api/scout/run"),
      deps,
    );
    emitter.emit("data", Buffer.from(JSON.stringify({ queries: ["q1"] })));
    emitter.emit("end");
    assert.equal(await handledPromise, true);
    assert.equal(res.writableEnded, true);
    emitter.emit("close");
    assert.ok(seenSignal);
    assert.equal(seenSignal.aborted, false);
    assert.match(state.headers["Content-Type"], /application\/x-ndjson/);
  });

  it("rejects invalid JSON on POST /api/search with 400", async () => {
    const { handled, state } = await call("POST", "/api/search", {
      rawBody: "not json",
    });
    assert.equal(handled, true);
    assert.equal(state.status, 400);
    const body = JSON.parse(state.chunks.join("")) as Record<string, unknown>;
    assert.equal(body.error, "bad_request");
  });

  it("rejects a missing message on POST /api/scout/log with 400", async () => {
    const { handled, state } = await call("POST", "/api/scout/log", {
      body: {},
    });
    assert.equal(handled, true);
    assert.equal(state.status, 400);
    const body = JSON.parse(state.chunks.join("")) as Record<string, unknown>;
    assert.equal(body.error, "bad_request");
  });

  it("refunds the sortie when collect fails", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async () => ({
        ok: false,
        status: 500,
        error: "x_api",
        message: "boom",
      })) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("keeps the sortie when a run lands cool threads", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async (opts) => {
        opts.onEvent?.({
          ...doneEvent,
          coolCount: 2,
          threads: [{ id: "1" }, { id: "2" }],
        });
        return {
          ok: true,
          event: {
            ...doneEvent,
            coolCount: 2,
            threads: [{ id: "1" }, { id: "2" }],
          },
        };
      }) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 1);
  });

  it("refunds the sortie when a finished run finds no cool threads", async () => {
    const tenantId = getLocalTenantId();
    await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps: stubDeps(),
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("refunds the sortie on POST /api/search when the batch fails", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutSearch: (async () => ({
        ok: false,
        status: 502,
        error: "bad_gateway",
        message: "x api down",
      })) as typeof runScoutSearch,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/search", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("keeps the sortie on POST /api/search when a batch lands cool threads", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutSearch: (async () => ({
        ok: true,
        event: {
          ...doneEvent,
          threads: [
            { id: "1", engage: "consider", baitScore: 20, onAgenda: true },
            { id: "2", engage: "priority", baitScore: 10, onAgenda: true },
          ],
          queries: ["q1"],
        },
      })) as typeof runScoutSearch,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/search", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 1);
  });

  it("refunds the sortie on POST /api/search when a batch lands only non-cool threads", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutSearch: (async () => ({
        ok: true,
        event: {
          ...doneEvent,
          threads: [
            { id: "1", engage: "skip", baitScore: 85 },
            { id: "2", engage: "consider", threadKind: "hollow_ask", baitScore: 20 },
          ],
          queries: ["q1"],
        },
      })) as typeof runScoutSearch,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/search", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("refunds the sortie on POST /api/search when a batch lands zero threads", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutSearch: (async () => ({
        ok: true,
        event: {
          ...doneEvent,
          threads: [],
          queries: ["q1"],
        },
      })) as typeof runScoutSearch,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/search", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("refunds the sortie on POST /api/search when the 200 write throws", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutSearch: (async () => ({
        ok: true,
        event: {
          ...doneEvent,
          threads: [
            { id: "1", engage: "consider", baitScore: 20, onAgenda: true },
            { id: "2", engage: "priority", baitScore: 10, onAgenda: true },
          ],
          queries: ["q1"],
        },
      })) as typeof runScoutSearch,
      ensureMemoryIndex: async () => {},
    };
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
      headers: { cookie: pilot.cookie },
      socket: { remoteAddress: "127.0.0.1" },
    });
    const state: FakeState = { status: 0, headers: {}, chunks: [] };
    let writeHeadCalls = 0;
    let firstEnd = true;
    const res = {
      writableEnded: false,
      writeHead(code: number, headers?: Record<string, string>) {
        writeHeadCalls += 1;
        if (writeHeadCalls > 1) {
          throw new Error("ERR_HTTP_HEADERS_SENT");
        }
        state.status = code;
        if (headers) Object.assign(state.headers, headers);
        return this;
      },
      write(chunk: unknown) {
        state.chunks.push(String(chunk));
        return true;
      },
      end(chunk?: unknown) {
        if (firstEnd) {
          firstEnd = false;
          throw new Error("socket torn down");
        }
        if (chunk !== undefined) state.chunks.push(String(chunk));
        this.writableEnded = true;
      },
    } as unknown as ServerResponse;
    const emitter = req as unknown as EventEmitter;
    const handledPromise = tryHandleScout(
      req,
      res,
      new URL("http://localhost/api/search"),
      deps,
    );
    emitter.emit("data", Buffer.from(JSON.stringify({ queries: ["q1"] })));
    emitter.emit("end");
    assert.equal(await handledPromise, true);
    // writeHead(200) ran, but end(json) threw — the client never got the
    // threads, so the takeoff is wasted the same as a failed batch.
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("refunds the sortie on POST /api/search when the batch rejects", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutSearch: (async () => {
        throw new Error("boom");
      }) as typeof runScoutSearch,
      ensureMemoryIndex: async () => {},
    };
    const { handled, state } = await call("POST", "/api/search", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(handled, true);
    assert.equal(state.status, 500);
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("refunds the sortie when a run rejects", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async () => {
        throw new Error("boom");
      }) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 0);
  });

  it("ends the stream with an error line when a run rejects mid-stream", async () => {
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async () => {
        throw new Error("boom");
      }) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    const { handled, state, res } = await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(handled, true);
    const lines = ndjsonLines(state.chunks);
    assert.equal(lines.at(-1)?.stage, "error");
    assert.match(String(lines.at(-1)?.message), /boom/);
    assert.equal(res.writableEnded, true);
  });

  it("keeps the sortie when a run delivered cools before failing", async () => {
    const tenantId = getLocalTenantId();
    const deps: ScoutHttpDeps = {
      runScoutCollect: (async (opts) => {
        opts.onEvent?.({
          agent: "scout",
          stage: "partial",
          message: "Cool 2/5",
          at: new Date().toISOString(),
          coolCount: 2,
        });
        opts.onEvent?.({
          agent: "scout",
          stage: "searching",
          message: "Cand. 1/5 · searching X…",
          at: new Date().toISOString(),
          coolCount: 0,
        });
        return { ok: false, status: 500, error: "x_api", message: "boom" };
      }) as typeof runScoutCollect,
      ensureMemoryIndex: async () => {},
    };
    await call("POST", "/api/scout/run", {
      body: { queries: ["q1"] },
      deps,
    });
    assert.equal(getSortieUsage(tenantId, "free").used, 1);
  });

  it("ignores unrelated paths", async () => {
    for (const path of ["/api/health", "/api/expired", "/api/interacted"]) {
      const { handled, state } = await call("GET", path);
      assert.equal(handled, false, path);
      assert.equal(state.status, 0, path);
    }
  });
});
