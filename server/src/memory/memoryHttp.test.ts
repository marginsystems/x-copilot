import { objectValue } from "../platform/unknownValue.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { tryHandleMemory, type MemoryHttpDeps } from "./memoryHttp.ts";
import type { SearchMemoryOpts } from "./memoryIndex.ts";

const LOCAL = "http://127.0.0.1:5173";

function signIn(tag: string): { userId: string; cookie: string } {
  const user = upsertOauthUser({
    provider: "google",
    providerUserId: `gid-${tag}`,
    email: `${tag}@example.com`,
    emailVerified: true,
  });
  const { token } = createSession(user.id);
  return {
    userId: user.id,
    cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
  };
}

async function post(
  path: string,
  opts: { origin?: string; body?: unknown; cookie?: string } = {},
  deps: MemoryHttpDeps = {},
): Promise<{ handled: boolean; status: number; body: Record<string, unknown> }> {
  const req = new IncomingMessage(new Socket());
  const headers: Record<string, string> = {};
  if (opts.origin) headers.origin = opts.origin;
  if (opts.cookie) headers.cookie = opts.cookie;
  Object.assign(req, {
    method: "POST",
    headers,
    socket: { remoteAddress: "127.0.0.1" },
  });
  let status = 0;
  let raw = "";
  const res = Object.assign(new ServerResponse(req), {
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(chunk: string) {
      raw = chunk;
      return this;
    },
  });
  const handledPromise = tryHandleMemory(
    req,
    res,
    new URL(`http://localhost${path}`),
    deps,
  );
  if (opts.body !== undefined) {
    req.emit("data", Buffer.from(JSON.stringify(opts.body)));
  }
  req.emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    body: raw ? (objectValue(JSON.parse(raw))) : {},
  };
}

/** Search spy that records calls and never touches a model or database. */
function spySearch(result: { hits: never[]; error?: string } = { hits: [] }) {
  const calls: SearchMemoryOpts[] = [];
  const deps: MemoryHttpDeps = {
    ensureMemoryIndex: async () => {},
    searchMemory: async (opts) => {
      calls.push(opts);
      return result;
    },
  };
  return { calls, deps };
}

await describe("memoryHttp", async () => {
  let temp: TempPlatformDb;
  let a: { userId: string; cookie: string };
  let b: { userId: string; cookie: string };

  beforeEach(() => {
    temp = openTempPlatformDb("x-memory-http-");
    a = signIn("a");
    b = signIn("b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("rejects a non-local Origin on search before checking the session", async () => {
    const { calls, deps } = spySearch();
    const { handled, status, body } = await post(
      "/api/memory/search",
      { origin: "https://evil.example", body: { query: "hi" }, cookie: a.cookie },
      deps,
    );
    assert.equal(handled, true);
    assert.equal(status, 403);
    assert.equal(body.error, "forbidden");
    assert.equal(calls.length, 0);
  });

  await it("rejects a non-local Origin on reindex", async () => {
    const { handled, status, body } = await post("/api/memory/reindex", {
      origin: "https://evil.example",
    });
    assert.equal(handled, true);
    assert.equal(status, 403);
    assert.equal(body.error, "forbidden");
  });

  await it("returns 401 without a session and never reaches the index", async () => {
    let ensured = 0;
    const { calls, deps } = spySearch();
    deps.ensureMemoryIndex = async () => {
      ensured++;
    };
    const { status, body } = await post(
      "/api/memory/search",
      { origin: LOCAL, body: { query: "hi" } },
      deps,
    );
    assert.equal(status, 401);
    assert.equal(body.error, "unauthenticated");
    assert.equal(calls.length, 0);
    assert.equal(ensured, 0);
  });

  await it("rejects a body-supplied userId or tenantId even with a valid session", async () => {
    const { calls, deps } = spySearch();
    for (const forged of [
      { query: "hi", userId: b.userId },
      { query: "hi", tenantId: "tenant-1" },
      { query: "hi", userId: a.userId },
    ]) {
      const { status, body } = await post(
        "/api/memory/search",
        { origin: LOCAL, body: forged, cookie: a.cookie },
        deps,
      );
      assert.equal(status, 400);
      assert.equal(body.error, "bad_request");
      assert.match(String(body.message), /userId|tenantId/);
    }
    assert.equal(calls.length, 0);
  });

  await it("rejects a missing search query", async () => {
    const { calls, deps } = spySearch();
    const { handled, status, body } = await post(
      "/api/memory/search",
      { origin: LOCAL, body: {}, cookie: a.cookie },
      deps,
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(body.error, "bad_request");
    assert.equal(calls.length, 0);
  });

  await it("returns 400 for a primitive JSON body", async () => {
    const { calls, deps } = spySearch();
    const { status, body } = await post(
      "/api/memory/search",
      { origin: LOCAL, body: "hello", cookie: a.cookie },
      deps,
    );
    assert.equal(status, 400);
    assert.equal(body.error, "bad_request");
    assert.equal(calls.length, 0);
  });

  await it("searches as the session user only, after ensuring the index", async () => {
    const order: string[] = [];
    const { calls, deps } = spySearch();
    deps.ensureMemoryIndex = async () => {
      order.push("ensure");
    };
    const inner = deps.searchMemory!;
    deps.searchMemory = async (opts) => {
      order.push("search");
      return inner(opts);
    };
    const { status, body } = await post(
      "/api/memory/search",
      { origin: LOCAL, body: { query: "  ship weekly ", k: 99, types: ["dismissal", "bogus"] }, cookie: a.cookie },
      deps,
    );
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, hits: [] });
    assert.deepEqual(order, ["ensure", "search"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.userId, a.userId);
    assert.equal(calls[0]!.query, "ship weekly");
    assert.equal(calls[0]!.k, 20);
    assert.deepEqual(calls[0]!.types, ["dismissal"]);

    const asB = await post(
      "/api/memory/search",
      { origin: LOCAL, body: { query: "ship weekly" }, cookie: b.cookie },
      deps,
    );
    assert.equal(asB.status, 200);
    assert.equal(calls[1]!.userId, b.userId);
  });

  await it("reports an unavailable index as 503 with no hits", async () => {
    const { deps } = spySearch({ hits: [], error: "Embedding model unavailable" });
    const { status, body } = await post(
      "/api/memory/search",
      { origin: LOCAL, body: { query: "hi" }, cookie: a.cookie },
      deps,
    );
    assert.equal(status, 503);
    assert.equal(body.error, "memory_unavailable");
    assert.deepEqual(body.hits, []);
  });

  await it("reindex returns operational counts only", async () => {
    const { status, body } = await post(
      "/api/memory/reindex",
      { origin: LOCAL },
      {
        runMemoryReindex: async () => ({ ok: true, indexed: 3, skipped: 1, excluded: 2 }),
      },
    );
    assert.equal(status, 200);
    assert.deepEqual(body, { ok: true, indexed: 3, skipped: 1, excluded: 2 });
  });

  await it("ignores unrelated paths", async () => {
    const { handled, status } = await post("/api/usage", { body: {} });
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
