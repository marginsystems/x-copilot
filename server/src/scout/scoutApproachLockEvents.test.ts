import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultMigrationsDir, getPlatformDb, resetPlatformDbForTests } from "../db.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { createSession } from "../auth/sessionStore.ts";
import { publishDeskEvent, resetDeskEventsForTests } from "../desk/deskEvents.ts";
import { testRequest } from "../http/http.testHelpers.ts";
import {
  SCOUT_APPROACH_LOCK_EVENTS_PATH,
  SCOUT_APPROACH_LOCK_WATCHERS_MAX,
  publishScoutApproachLockChanged,
  resetScoutApproachLockEventsForTests,
  scoutApproachLockWritten,
  tryHandleScoutApproachLockEvents,
} from "./scoutApproachLockEvents.ts";

function mockRes(opts: { slow?: boolean } = {}) {
  let status = 0;
  let destroyed = false;
  const chunks: string[] = [];
  const closers: Array<() => void> = [];
  const res = Object.assign(new ServerResponse(testRequest()), {
    writeHead(code: number) {
      status = code;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return !opts.slow;
    },
    end(chunk?: string) {
      if (chunk) chunks.push(chunk);
    },
    destroy() {
      destroyed = true;
      for (const close of closers) close();
    },
    once(_event: string, close: () => void) {
      closers.push(close);
      return res;
    },
  });
  return { res, status: () => status, frames: () => chunks.join(""), destroyed: () => destroyed };
}

function watch(authorization: string | null, opts: { slow?: boolean; method?: string } = {}) {
  const req = Object.assign(testRequest(), {
    method: opts.method ?? "GET",
    headers: authorization ? { authorization } : {},
  });
  const mock = mockRes({ slow: opts.slow });
  const handled = tryHandleScoutApproachLockEvents(
    req,
    mock.res,
    new URL(`http://localhost${SCOUT_APPROACH_LOCK_EVENTS_PATH}`),
  );
  return { ...mock, handled };
}

function extensionUser(providerUserId: string): { userId: string; authorization: string } {
  const user = upsertOauthUser({
    provider: "google",
    providerUserId,
    email: `${providerUserId}@example.com`,
    emailVerified: true,
  });
  const { token } = createSession(user.id, undefined, "extension");
  return { userId: user.id, authorization: `Bearer ${token}` };
}

await describe("scout approach lock events", async () => {
  let dir = "";

  beforeEach(() => {
    resetPlatformDbForTests();
    resetScoutApproachLockEventsForTests();
    resetDeskEventsForTests();
    dir = mkdtempSync(join(tmpdir(), "x-lock-events-"));
    process.env.PLATFORM_DB_PATH = join(dir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
  });

  afterEach(() => {
    resetScoutApproachLockEventsForTests();
    resetDeskEventsForTests();
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  await it("ignores other paths and refuses anonymous or non-GET requests", () => {
    const req = Object.assign(testRequest(), { method: "GET", headers: {} });
    assert.equal(
      tryHandleScoutApproachLockEvents(req, mockRes().res, new URL("http://localhost/api/scout-approach-lock")),
      false,
    );
    const anonymous = watch(null);
    assert.equal(anonymous.handled, true);
    assert.match(anonymous.frames(), /unauthenticated/);
    const alice = extensionUser("alice");
    assert.match(watch(alice.authorization, { method: "POST" }).frames(), /method_not_allowed/);
  });

  await it("tells only the writer's own watchers that the lock changed", () => {
    const alice = extensionUser("alice");
    const bob = extensionUser("bob");
    const alicePanel = watch(alice.authorization);
    const bobPanel = watch(bob.authorization);
    assert.equal(alicePanel.status(), 200);
    assert.match(alicePanel.frames(), /^event: ready\ndata: \{\}\n\n$/);

    assert.equal(publishScoutApproachLockChanged(alice.userId), 1);
    assert.match(alicePanel.frames(), /event: lock_changed\ndata: \{\}\n\n$/);
    assert.doesNotMatch(bobPanel.frames(), /lock_changed/);
  });

  await it("does not count as an open desk for a remote Next", () => {
    const alice = extensionUser("alice");
    watch(alice.authorization);
    assert.equal(publishDeskEvent(alice.userId, "approach_next", { forYou: true }), 0);
  });

  await it("drops a watcher that cannot keep up and the oldest past the cap", () => {
    const alice = extensionUser("alice");
    const slow = watch(alice.authorization, { slow: true });
    assert.equal(publishScoutApproachLockChanged(alice.userId), 0);
    assert.equal(slow.destroyed(), true);
    assert.equal(publishScoutApproachLockChanged(alice.userId), 0);

    const panels = Array.from({ length: SCOUT_APPROACH_LOCK_WATCHERS_MAX + 1 }, () => watch(alice.authorization));
    assert.equal(panels[0]?.destroyed(), true);
    assert.equal(panels[1]?.destroyed(), false);
    assert.equal(publishScoutApproachLockChanged(alice.userId), SCOUT_APPROACH_LOCK_WATCHERS_MAX);
  });

  await it("treats only a successful PUT as a lock write", () => {
    const written = (method: string, statusCode: number) => {
      const req = Object.assign(testRequest(), { method });
      const res = Object.assign(new ServerResponse(req), { statusCode });
      return scoutApproachLockWritten(req, res);
    };
    assert.equal(written("PUT", 200), true);
    assert.equal(written("PUT", 400), false);
    assert.equal(written("PUT", 429), false);
    assert.equal(written("GET", 200), false);
  });
});
