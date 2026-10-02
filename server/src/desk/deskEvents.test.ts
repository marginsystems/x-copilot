import { testRequest } from "../http/http.testHelpers.js";
import { expectRecord } from "../http/http.testHelpers.js";
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import {
  DESK_EVENT_BUFFER_MS,
  publishDeskEvent,
  resetDeskEventsForTests,
  tryHandleDeskEvents,
  tryHandleDeskEventsWake,
  warnIfDeskEventsSecretMissing,
} from "./deskEvents.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { resetRateLimiterForTests } from "../auth/authGuard.ts";
import { APPROACH_NEXT_RATE, tryHandleApproachNext } from "./approachNextHttp.ts";

function mockRes(opts: { slow?: boolean } = {}) {
  let status = 0;
  let destroyed = false;
  const chunks: string[] = [];
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
    },
    once() {
      return res;
    },
  });
  return { res, status: () => status, chunks, destroyed: () => destroyed };
}

function subscribe(
  cookie: string,
  opts: { lastEventId?: string; query?: string; slow?: boolean } = {},
) {
  const req = Object.assign(testRequest(), {
    method: "GET",
    headers: {
      cookie,
      ...(opts.lastEventId ? { "last-event-id": opts.lastEventId } : {}),
    },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const mock = mockRes({ slow: opts.slow });
  assert.equal(
    tryHandleDeskEvents(req, mock.res, new URL(`http://localhost/api/desk/events${opts.query ?? ""}`)),
    true,
  );
  return mock;
}

function eventIds(raw: string): string[] {
  return [...raw.matchAll(/^id: (.+)$/gm)].map((match) => match[1] ?? "");
}

function signedInCookie(providerUserId: string): { userId: string; cookie: string } {
  const user = upsertOauthUser({
    provider: "google",
    providerUserId,
    email: `${providerUserId}@example.com`,
    emailVerified: true,
  });
  const { token } = createSession(user.id);
  return { userId: user.id, cookie: `${SESSION_COOKIE}=${token}` };
}

const interacted = {
  threadId: "thread-1",
  author: "@target",
  at: "2026-09-15T00:00:02.000Z",
  replyId: "reply-1",
  replyUrl: "https://x.com/pilot/status/reply-1",
  postedAt: "2026-09-15T00:00:01.000Z",
  conversationId: "root-1",
  inReplyToId: "parent-1",
};

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

async function approachNext(
  cookie: string | undefined,
  body: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const req = Object.assign(testRequest(), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    socket: { remoteAddress: "127.0.0.1" },
  });
  const { res, status, chunks } = mockRes();
  const pending = tryHandleApproachNext(req, res, new URL("http://localhost/api/desk/approach/next"));
  (req).emit("data", Buffer.from(JSON.stringify(body)));
  (req).emit("end");
  assert.equal(await pending, true);
  const raw = chunks.join("");
  return { status: status(), json: raw ? expectRecord(JSON.parse(raw)) : {} };
}

await describe("desk events", async () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    resetDeskEventsForTests();
    resetRateLimiterForTests();
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

  for (const secret of [undefined, "", "  \t "]) {
    await it(`warns once when the desk event secret is ${JSON.stringify(secret)}`, (t) => {
      if (secret === undefined) delete process.env.DESK_EVENTS_SECRET;
      else process.env.DESK_EVENTS_SECRET = secret;
      const warn = t.mock.method(console, "warn", () => {});
      warnIfDeskEventsSecretMissing();
      warnIfDeskEventsSecretMissing();
      assert.equal(warn.mock.callCount(), 1);
      assert.deepEqual(warn.mock.calls[0]?.arguments, [
        "[desk] DESK_EVENTS_SECRET is empty; desk wakes will be rejected (403).",
      ]);
    });
  }

  await it("does not warn when the desk event secret is configured", (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    warnIfDeskEventsSecretMissing();
    assert.equal(warn.mock.callCount(), 0);
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
      url: "https://x.com/pilot/status/post-1",
      text: "my reply",
    });
    assert.equal(mine.status, 200);
    const frame = chunks.join("").split("\n\n").find((chunk) => chunk.includes("event: own_post"));
    assert.ok(frame);
    assert.deepEqual(JSON.parse(frame.split("data: ")[1] ?? ""), {
      id: "post-1",
      kind: "reply",
      postedAt: "2026-09-15T00:00:01.000Z",
      url: "https://x.com/pilot/status/post-1",
      text: "my reply",
    });
  });

  await it("publishes a long own_post wake instead of rejecting its body", async () => {
    const { userId, cookie } = signedInCookie("desk-long-own-post");
    const desk = subscribe(cookie);
    const text = "😀".repeat(25_000);

    const out = await wake({
      userId,
      id: "long-post",
      kind: "original",
      postedAt: "2026-09-15T00:00:01.000Z",
      url: "https://x.com/pilot/status/long-post",
      text,
    });

    assert.equal(out.status, 200);
    const frame = desk.chunks.join("").split("\n\n").find((chunk) => chunk.includes("event: own_post"));
    assert.ok(frame);
    const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length);
    assert.equal(expectRecord(JSON.parse(data ?? "")).text, text);
  });

  await it("publishes the post-mark interacted event with the ids the card matches on", async () => {
    const { userId, cookie } = signedInCookie("desk-interacted");
    const desk = subscribe(cookie);
    const out = await wake({
      userId,
      type: "interacted",
      interaction: { ...interacted, source: "discovered", authorKey: "target", userId, stats: {} },
    });
    assert.equal(out.status, 200);
    const frame = desk.chunks.join("").split("\n\n").find((chunk) => chunk.includes("event: interacted"));
    assert.ok(frame);
    const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice("data: ".length);
    assert.deepEqual(JSON.parse(data ?? ""), interacted);
    assert.equal(eventIds(desk.chunks.join("")).length, 1);
  });

  await it("rejects an interacted wake without a thread, author, or time", async () => {
    const { userId } = signedInCookie("desk-interacted-bad");
    for (const interaction of [
      { ...interacted, threadId: "" },
      { ...interacted, author: undefined },
      { ...interacted, at: "never" },
      null,
    ]) {
      const out = await wake({ userId, type: "interacted", interaction });
      assert.equal(out.status, 400);
    }
  });

  await it("gives each event an increasing id and replays missed events after Last-Event-ID", () => {
    const { userId, cookie } = signedInCookie("desk-replay");
    const first = subscribe(cookie);
    publishDeskEvent(userId, "own_post", { id: "post-1", kind: "reply", postedAt: "2026-09-15T00:00:00.000Z" });
    publishDeskEvent(userId, "interacted", interacted);
    const ids = eventIds(first.chunks.join(""));
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1]);

    publishDeskEvent(userId, "interacted", { ...interacted, threadId: "thread-2" });
    const header = subscribe(cookie, { lastEventId: ids[0] });
    const replayed = header.chunks.join("");
    assert.equal(eventIds(replayed).length, 2);
    assert.match(replayed, /"threadId":"thread-1"/);
    assert.match(replayed, /"threadId":"thread-2"/);
    assert.doesNotMatch(replayed, /own_post/);
    assert.ok(replayed.indexOf("event: ready") > replayed.lastIndexOf("event: interacted"));

    const query = subscribe(cookie, { query: `?lastEventId=${encodeURIComponent(ids[1] ?? "")}` });
    assert.equal(eventIds(query.chunks.join("")).length, 1);
    assert.match(query.chunks.join(""), /"threadId":"thread-2"/);

    const fresh = subscribe(cookie);
    assert.deepEqual(eventIds(fresh.chunks.join("")), []);
  });

  await it("replays the whole buffer to a desk that last heard a previous server boot", () => {
    const { userId, cookie } = signedInCookie("desk-reboot");
    publishDeskEvent(userId, "interacted", interacted);
    const desk = subscribe(cookie, { lastEventId: "previous-boot.99" });
    assert.equal(eventIds(desk.chunks.join("")).length, 1);
  });

  await it("drops events older than the buffer window", () => {
    const { userId, cookie } = signedInCookie("desk-stale");
    const now = Date.now();
    publishDeskEvent(userId, "interacted", interacted, now - DESK_EVENT_BUFFER_MS - 1);
    publishDeskEvent(userId, "interacted", { ...interacted, threadId: "thread-2" }, now);
    const desk = subscribe(cookie, { lastEventId: "previous-boot.0" });
    const replayed = desk.chunks.join("");
    assert.equal(eventIds(replayed).length, 1);
    assert.match(replayed, /"threadId":"thread-2"/);
  });

  await it("expires buffered events for idle users", (t) => {
    t.mock.timers.enable({ apis: ["setInterval", "Date"], now: 0 });
    const idle = signedInCookie("desk-idle-buffer");
    publishDeskEvent(idle.userId, "interacted", interacted, 0);
    t.mock.timers.tick(DESK_EVENT_BUFFER_MS);
    const desk = subscribe(idle.cookie, { lastEventId: "previous-boot.0" });
    assert.equal(eventIds(desk.chunks.join("")).length, 0);
  });

  await it("drops a slow desk and replays the missed event when it reconnects", () => {
    const { userId, cookie } = signedInCookie("desk-slow");
    const slow = subscribe(cookie, { slow: true });
    publishDeskEvent(userId, "own_post", { id: "post-1", kind: "reply", postedAt: "2026-09-15T00:00:00.000Z" });
    const lastEventId = eventIds(slow.chunks.join(""))[0] ?? "";
    assert.equal(slow.destroyed(), true);
    publishDeskEvent(userId, "interacted", interacted);
    const reconnected = subscribe(cookie, { lastEventId });
    assert.equal(eventIds(reconnected.chunks.join("")).length, 1);
    assert.match(reconnected.chunks.join(""), /event: interacted/);
  });

  await it("relays approach Next live to the user's open desks and reports delivery", async () => {
    const alice = signedInCookie("gid-next-a");
    const bob = signedInCookie("gid-next-b");
    assert.deepEqual((await approachNext(alice.cookie, { fromCardId: "c1" })).json, { ok: true, delivered: false });
    const aliceDesk = subscribe(alice.cookie);
    const bobDesk = subscribe(bob.cookie);
    const sent = await approachNext(alice.cookie, { fromCardId: " c1 " });
    assert.equal(sent.status, 200);
    assert.deepEqual(sent.json, { ok: true, delivered: true });
    const frames = aliceDesk.chunks.join("");
    assert.match(frames, /event: approach_next\ndata: \{"fromCardId":"c1"\}/);
    assert.doesNotMatch(bobDesk.chunks.join(""), /approach_next/);
  });

  await it("never replays approach Next to a desk that reconnects later", async () => {
    const alice = signedInCookie("gid-next-replay");
    subscribe(alice.cookie);
    await approachNext(alice.cookie, { fromCardId: "c1" });
    publishDeskEvent(alice.userId, "interacted", interacted);
    const late = subscribe(alice.cookie, { lastEventId: "0.0" });
    const replay = late.chunks.join("");
    assert.match(replay, /event: interacted/);
    assert.doesNotMatch(replay, /approach_next/);
  });

  await it("refuses approach Next without a session, a card id, or past the rate limit", async () => {
    const alice = signedInCookie("gid-next-refuse");
    assert.equal((await approachNext(undefined, { fromCardId: "c1" })).status, 401);
    assert.equal((await approachNext(alice.cookie, {})).status, 400);
    assert.equal((await approachNext(alice.cookie, { fromCardId: "x".repeat(65) })).status, 400);
    for (let i = 0; i < APPROACH_NEXT_RATE.max - 2; i += 1) {
      assert.equal((await approachNext(alice.cookie, { fromCardId: "c1" })).status, 200);
    }
    assert.equal((await approachNext(alice.cookie, { fromCardId: "c1" })).status, 429);
  });
});
