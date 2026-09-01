import { describe, it, beforeEach, afterEach } from "node:test";
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
  chooseDeskFork,
  getDeskBeats,
  recordDeskOriginalPosted,
  recordDeskReplyMarked,
} from "./deskBeats.ts";
import { tryHandleDeskBeats } from "./deskBeatsHttp.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";

const DAY_ONE = Date.parse("2026-08-31T23:59:59.000Z");
const DAY_TWO = Date.parse("2026-09-01T00:00:00.000Z");

describe("deskBeats", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-desk-beats-"));
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

  it("isolates progress by UTC day and user", () => {
    recordDeskReplyMarked({ userId: "u1", source: "scout", nowMs: DAY_ONE });

    assert.equal(getDeskBeats({ userId: "u1", nowMs: DAY_ONE }).scoutReplyDone, true);
    assert.equal(getDeskBeats({ userId: "u1", nowMs: DAY_TWO }).scoutReplyDone, false);
    assert.equal(getDeskBeats({ userId: "u2", nowMs: DAY_ONE }).scoutReplyDone, false);
  });

  it("persists reply and original forks through done", () => {
    recordDeskReplyMarked({ userId: "reply", source: "scout", nowMs: DAY_ONE });
    recordDeskReplyMarked({ userId: "reply", source: "organic", nowMs: DAY_ONE });
    assert.equal(
      chooseDeskFork({
        userId: "reply",
        forkChoice: "reply",
        nowMs: DAY_ONE,
      }).forkChoice,
      "reply",
    );
    assert.equal(
      recordDeskReplyMarked({ userId: "reply", source: "organic", nowMs: DAY_ONE }).forkDone,
      true,
    );

    recordDeskReplyMarked({ userId: "original", source: "scout", nowMs: DAY_ONE });
    recordDeskReplyMarked({ userId: "original", source: "organic", nowMs: DAY_ONE });
    chooseDeskFork({
      userId: "original",
      forkChoice: "original",
      nowMs: DAY_ONE,
    });
    assert.equal(
      recordDeskOriginalPosted({ userId: "original", nowMs: DAY_ONE }).forkDone,
      true,
    );
  });

  it("persists an organic mark made before the scout mark", () => {
    recordDeskReplyMarked({ userId: "u1", source: "organic", nowMs: DAY_ONE });
    const beats = recordDeskReplyMarked({
      userId: "u1",
      source: "scout",
      nowMs: DAY_ONE,
    });

    assert.equal(beats.scoutReplyDone, true);
    assert.equal(beats.organicReplyDone, true);
  });

  it("rejects an early fork and ignores an early original", () => {
    assert.equal(
      chooseDeskFork({
        userId: "u1",
        forkChoice: "original",
        nowMs: DAY_ONE,
      }).forkChoice,
      null,
    );
    assert.equal(
      recordDeskOriginalPosted({ userId: "u1", nowMs: DAY_ONE }).forkDone,
      false,
    );
  });

  it("accepts an authenticated fork choice write", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "desk-beats-user",
      email: "desk-beats@example.com",
      emailVerified: true,
    });
    recordDeskReplyMarked({ userId: user.id, source: "scout" });
    recordDeskReplyMarked({ userId: user.id, source: "organic" });
    const { token } = createSession(user.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "POST",
      headers: {
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      },
      socket: { remoteAddress: "127.0.0.1" },
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
    const handledPromise = tryHandleDeskBeats(
      req,
      res,
      new URL("http://localhost/api/desk/beats"),
    );
    req.emit("data", Buffer.from('{"forkChoice":"original"}'));
    req.emit("end");

    assert.equal(await handledPromise, true);
    assert.equal(status, 200);
    const json = JSON.parse(raw) as {
      beats?: { forkChoice?: string };
    };
    assert.equal(json.beats?.forkChoice, "original");
  });
});
