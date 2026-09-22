import { isRecord } from "../platform/unknownValue.js";
import { testRequest } from "../http/http.testHelpers.js";
import { expectRecord } from "../http/http.testHelpers.js";
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { completeOnboarding } from "../auth/authStore.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { resetRateLimiterForTests } from "../auth/authGuard.ts";
import { tryHandleAgenda } from "./agendaHttp.ts";

const AGENDA =
  "Find founders sharing concrete takes on shipping AI tools in public. Prefer a clear point of view. Skip empty engagement bait.";

await describe("PUT /api/agenda", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetRateLimiterForTests();
    dir = mkdtempSync(join(tmpdir(), "x-agenda-"));
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

  async function putAgenda(opts: {
    cookie?: boolean;
    origin?: string | null;
    body?: unknown;
    email?: string;
  }): Promise<{ status: number; json: Record<string, unknown> }> {
    const actor = upsertOauthUser({
      provider: "google",
      providerUserId: `gid-${opts.email ?? "desk@example.com"}`,
      email: opts.email ?? "desk@example.com",
      emailVerified: true,
    });
    completeOnboarding(actor.id, AGENDA);
    const { token } = createSession(actor.id);
    const req = testRequest();
    const headers: Record<string, string> = {};
    if (opts.cookie !== false) {
      headers.cookie = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    }
    if (opts.origin !== null) {
      headers.origin = opts.origin ?? "http://localhost:5173";
    }
    Object.assign(req, {
      method: "PUT",
      headers,
      socket: { remoteAddress: "127.0.0.1" },
      destroy: () => {},
    });
    let status = 0;
    let raw = "";
    const res = Object.assign(new ServerResponse(testRequest()), {
      writeHead: (code: number) => {
        status = code;
      },
      end: (chunk: string) => {
        raw = chunk;
      },
    });
    const handledPromise = tryHandleAgenda(
      req,
      res,
      new URL("http://localhost/api/agenda"),
    );
    if (opts.body !== undefined) {
      (req).emit("data", Buffer.from(JSON.stringify(opts.body)));
    }
    (req).emit("end");
    assert.equal(await handledPromise, true);
    return { status, json: expectRecord(JSON.parse(raw || "{}")) };
  }

  await it("writes users.agenda for the signed-in user", async () => {
    const next =
      "Meet researchers arguing about evaluation, not model drops. Prefer lived results. Skip launch-day hype threads.";
    const { status, json } = await putAgenda({ body: { agenda: `  ${next}  ` } });
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    const user = parseUserRow(json.user);
    assert.equal(user.agenda, next);
  });

  await it("rejects a short agenda", async () => {
    const { status, json } = await putAgenda({ body: { agenda: "too short" } });
    assert.equal(status, 400);
    assert.equal(json.error, "agenda_too_short");
  });

  await it("rejects a signed-out request", async () => {
    const { status, json } = await putAgenda({
      cookie: false,
      body: { agenda: AGENDA },
    });
    assert.equal(status, 401);
    assert.equal(json.error, "unauthenticated");
  });

  await it("rejects a non-local Origin", async () => {
    const { status, json } = await putAgenda({
      origin: "https://evil.example",
      body: { agenda: AGENDA },
    });
    assert.equal(status, 403);
    assert.equal(json.error, "forbidden");
  });

  await it("ignores unrelated paths", async () => {
    const req = testRequest();
    Object.assign(req, { method: "PUT", headers: {} });
    const res = Object.assign(new ServerResponse(testRequest()), {
      writeHead: () => {},
      end: () => {},
    });
    assert.equal(
      await tryHandleAgenda(req, res, new URL("http://localhost/api/usage")),
      false,
    );
  });
});

function parseUserRow(value: unknown): { agenda?: string } {
  const valid = (row: unknown): row is { agenda?: string } =>
    (isRecord(row) &&
    (row.agenda === undefined || typeof row.agenda === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
