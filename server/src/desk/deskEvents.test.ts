import { testRequest } from "../http/http.testHelpers.js";
import { expectRecord } from "../http/http.testHelpers.js";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import {
  resetDeskEventsForTests,
  tryHandleDeskEvents,
  tryHandleDeskEventsWake,
} from "./deskEvents.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";

function mockRes() {
  let status = 0;
  const chunks: string[] = [];
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
    },
    destroy() {},
    once() {
      return res;
    },
  });
  return { res, status: () => status, chunks };
}

async function wake(
  body: unknown,
  remoteAddress = "127.0.0.1",
  authorization = "Bearer desk-events-test-secret",
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = Object.assign(testRequest(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization },
    socket: { remoteAddress },
  });
  const { res, status, chunks } = mockRes();
  const pending = tryHandleDeskEventsWake(
    req,
    res,
    new URL("http://localhost/api/desk/events/wake"),
  );
  (req).emit("data", Buffer.from(JSON.stringify(body)));
  (req).emit("end");
  const handled = await pending;
  const raw = chunks.join("");
  return {
    handled,
    status: status(),
    json: raw ? (expectRecord(JSON.parse(raw))) : {},
  };
}

await describe("desk events", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetDeskEventsForTests();
    dir = mkdtempSync(join(tmpdir(), "x-desk-events-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    process.env.DESK_EVENTS_SECRET = "desk-events-test-secret";
    getPlatformDb();
  });

  afterEach(() => {
    resetDeskEventsForTests();
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    delete process.env.DESK_EVENTS_SECRET;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("GET /api/desk/events without a session is 401", () => {
    const req = Object.assign(testRequest(), {
      method: "GET",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    });
    const { res, status } = mockRes();
    assert.equal(
      tryHandleDeskEvents(req, res, new URL("http://localhost/api/desk/events")),
      true,
    );
    assert.equal(status(), 401);
  });

  await it("rejects a wake without the shared secret", async () => {
    const out = await wake(
      {
        userId: "u",
        id: "p",
        kind: "reply",
        postedAt: "2026-09-15T00:00:00.000Z",
      },
      "127.0.0.1",
      "",
    );
    assert.equal(out.handled, true);
    assert.equal(out.status, 403);
  });

  await it("rejects a wake from a non-loopback peer", async () => {
    const out = await wake(
      {
        userId: "u",
        id: "p",
        kind: "reply",
        postedAt: "2026-09-15T00:00:00.000Z",
      },
      "8.8.8.8",
    );
    assert.equal(out.handled, true);
    assert.equal(out.status, 403);
  });

  await it("writes own_post only to that user's subscribers", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "desk-events",
      email: "pilot@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const req = Object.assign(testRequest(), {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      socket: { remoteAddress: "127.0.0.1" },
    });
    const { res, status, chunks } = mockRes();
    assert.equal(
      tryHandleDeskEvents(req, res, new URL("http://localhost/api/desk/events")),
      true,
    );
    assert.equal(status(), 200);
    assert.match(chunks.join(""), /event: ready/);

    const other = await wake({
      userId: "someone-else",
      id: "other",
      kind: "reply",
      postedAt: "2026-09-15T00:00:00.000Z",
    });
    assert.equal(other.status, 200);
    assert.doesNotMatch(chunks.join(""), /own_post/);

    const mine = await wake({
      userId: user.id,
      id: "post-1",
      kind: "reply",
      postedAt: "2026-09-15T00:00:01.000Z",
    });
    assert.equal(mine.status, 200);
    assert.match(chunks.join(""), /event: own_post/);
    assert.match(chunks.join(""), /"id":"post-1"/);
  });
});
