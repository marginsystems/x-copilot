import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import {
  resetDeskEventsForTests,
  tryHandleDeskEvents,
  tryHandleDeskEventsWake,
} from "./deskEvents.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";

function mockRes() {
  let status = 0;
  const chunks: string[] = [];
  const res = {
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
  } as unknown as ServerResponse;
  return { res, status: () => status, chunks };
}

async function wake(
  body: unknown,
  remoteAddress = "127.0.0.1",
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = Object.assign(new EventEmitter(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    socket: { remoteAddress },
  }) as unknown as IncomingMessage;
  const { res, status, chunks } = mockRes();
  const pending = tryHandleDeskEventsWake(
    req,
    res,
    new URL("http://localhost/api/desk/events/wake"),
  );
  (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
  (req as EventEmitter).emit("end");
  const handled = await pending;
  const raw = chunks.join("");
  return {
    handled,
    status: status(),
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("desk events", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetDeskEventsForTests();
    dir = mkdtempSync(join(tmpdir(), "x-desk-events-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetDeskEventsForTests();
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it("GET /api/desk/events without a session is 401", () => {
    const req = Object.assign(new EventEmitter(), {
      method: "GET",
      headers: {},
      socket: { remoteAddress: "127.0.0.1" },
    }) as unknown as IncomingMessage;
    const { res, status } = mockRes();
    assert.equal(
      tryHandleDeskEvents(req, res, new URL("http://localhost/api/desk/events")),
      true,
    );
    assert.equal(status(), 401);
  });

  it("rejects a wake from a non-loopback peer", async () => {
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

  it("writes own_post only to that user's subscribers", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "desk-events",
      email: "pilot@example.com",
      emailVerified: true,
    });
    const { token } = createSession(user.id);
    const req = Object.assign(new EventEmitter(), {
      method: "GET",
      headers: { cookie: `${SESSION_COOKIE}=${token}` },
      socket: { remoteAddress: "127.0.0.1" },
    }) as unknown as IncomingMessage;
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
