import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDismissalHistory, markDismissed } from "./dismissalStore.ts";
import { markExpired } from "./expiredStore.ts";
import { resetHistoryHttpForTests, tryHandleHistory } from "./historyHttp.ts";
import { buildDismissalNotePath } from "../memory/knowledgeMemory.ts";
import { upsertOauthUser } from "../auth/oauthAccountStore.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { getLastScout, saveScoutCache } from "../scout/scoutCache.ts";
import { SESSION_COOKIE } from "../auth/sessionCookie.ts";
import { createSession } from "../auth/sessionStore.ts";
import { listSkipHistory, markSkipped } from "./skipStore.ts";
import { getPlatformDb } from "../db.ts";
import {
  explicitEventKey,
  getScoutEvidence,
  listScoutEvidence,
} from "../scout/scoutEvidence.ts";

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

async function call(
  method: string,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<{ handled: boolean; status: number; json: Record<string, unknown> }> {
  const req = new EventEmitter() as unknown as IncomingMessage;
  Object.assign(req, {
    method,
    headers: cookie ? { cookie } : {},
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
  const handledPromise = tryHandleHistory(
    req,
    res,
    new URL(`http://localhost${path}`),
  );
  if (body !== undefined) {
    (req as EventEmitter).emit("data", Buffer.from(JSON.stringify(body)));
  }
  (req as EventEmitter).emit("end");
  const handled = await handledPromise;
  return {
    handled,
    status,
    json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
  };
}

describe("historyHttp", () => {
  let temp: TempPlatformDb;
  let dir: string;
  let knowledgeRoot: string;
  let a: { userId: string; cookie: string };
  let b: { userId: string; cookie: string };

  beforeEach(() => {
    temp = openTempPlatformDb("x-history-http-");
    dir = mkdtempSync(join(tmpdir(), "x-history-http-knowledge-"));
    knowledgeRoot = join(dir, "knowledge");
    resetHistoryHttpForTests({ knowledgeRoot, scheduleUpsert: async () => {} });
    a = signIn("a");
    b = signIn("b");
  });

  afterEach(() => {
    resetHistoryHttpForTests();
    closeTempPlatformDb(temp);
    rmSync(dir, { recursive: true, force: true });
  });

  function dismissalNotes(): string[] {
    try {
      return readdirSync(join(knowledgeRoot, "dismissals")).filter((n) =>
        n.endsWith(".md"),
      );
    } catch {
      return [];
    }
  }

  it("POST /api/dismissed records the action first, then an owned note keyed by the durable time", async () => {
    const { status, json } = await call(
      "POST",
      "/api/dismissed",
      { threadId: "2081", author: "@x", text: "raw body", reason: "off topic" },
      a.cookie,
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(json.memory, { state: "saved" });
    const dismissal = json.dismissal as { at: string; threadId: string };
    const expectedPath = buildDismissalNotePath({
      userId: a.userId,
      threadId: "2081",
      dismissedAt: dismissal.at,
      knowledgeRoot,
    });
    assert.equal(json.memoryPath, expectedPath);
    const note = readFileSync(expectedPath, "utf8");
    assert.match(note, /type: dismissal/);
    assert.match(note, new RegExp(`userId: "${a.userId}"`));
    assert.match(note, /threadId: "2081"/);
    assert.match(note, new RegExp(`dismissedAt: "${dismissal.at.replace(/\./g, "\\.")}"`));
    assert.match(note, /off topic/);
    assert.match(note, /raw body/);
    assert.equal(dismissalNotes().length, 1);

    // Another desk dismissing the same thread gets its own note.
    const other = await call(
      "POST",
      "/api/dismissed",
      { threadId: "2081", author: "@x", reason: "b's reason" },
      b.cookie,
    );
    assert.equal(other.status, 200);
    assert.notEqual(other.json.memoryPath, expectedPath);
    assert.equal(dismissalNotes().length, 2);
    assert.match(readFileSync(expectedPath, "utf8"), /off topic/);
  });

  it("POST /api/dismissed succeeds with memory unavailable when the note write fails", async () => {
    resetHistoryHttpForTests({
      knowledgeRoot,
      writeDismissalNote: async () => {
        throw new Error("EACCES: injected filesystem failure");
      },
    });
    const { status, json } = await call(
      "POST",
      "/api/dismissed",
      { threadId: "2082", author: "@y", reason: "spam" },
      a.cookie,
    );
    assert.equal(status, 200);
    assert.equal(json.ok, true);
    assert.deepEqual(json.memory, { state: "unavailable" });
    assert.equal("memoryPath" in json, false);
    const rows = await listDismissalHistory({ userId: a.userId });
    assert.deepEqual(rows.map((r) => r.threadId), ["2082"]);
    assert.deepEqual(dismissalNotes(), []);
  });

  it("POST /api/dismissed keeps saved when the index upsert fails", async () => {
    resetHistoryHttpForTests({
      knowledgeRoot,
      scheduleUpsert: async () => {
        throw new Error("injected index failure");
      },
    });
    const { status, json } = await call(
      "POST",
      "/api/dismissed",
      { threadId: "2083", author: "@z" },
      a.cookie,
    );
    assert.equal(status, 200);
    assert.deepEqual(json.memory, { state: "saved" });
    assert.equal(typeof json.memoryPath, "string");
    assert.equal(dismissalNotes().length, 1);
  });

  it("POST /api/dismissed fails without writing any note when the durable store fails", async () => {
    resetHistoryHttpForTests({
      knowledgeRoot,
      markDismissed: async () => {
        throw new Error("injected sqlite failure");
      },
    });
    const { status, json } = await call(
      "POST",
      "/api/dismissed",
      { threadId: "2084", author: "@w", reason: "nope" },
      a.cookie,
    );
    assert.equal(status, 500);
    assert.equal(json.error, "store_failed");
    assert.deepEqual(dismissalNotes(), []);
    assert.deepEqual(await listDismissalHistory({ userId: a.userId }), []);
  });

  it("persists Scout actions when evidence context capture fails", async () => {
    getPlatformDb().exec("DROP TABLE scout_target_context");

    const skipped = await call(
      "POST",
      "/api/skipped",
      { threadId: "capture-failed-skip", author: "@x" },
      a.cookie,
    );
    const dismissed = await call(
      "POST",
      "/api/dismissed",
      { threadId: "capture-failed-dismiss", author: "@x" },
      a.cookie,
    );

    assert.equal(skipped.status, 200);
    assert.equal(dismissed.status, 200);
    assert.deepEqual(
      (await listDismissalHistory({ userId: a.userId })).map((row) => row.threadId),
      ["capture-failed-dismiss"],
    );
    assert.deepEqual(
      (await listSkipHistory({ userId: a.userId })).map((row) => row.threadId),
      ["capture-failed-skip"],
    );

    // The explicit votes still become evidence, keyed correctly, with the
    // context left unknown rather than guessed.
    const skipRow = getScoutEvidence(
      a.userId,
      explicitEventKey("skip", "scout", "capture-failed-skip"),
    );
    const dismissRow = getScoutEvidence(
      a.userId,
      explicitEventKey("dismiss", "scout", "capture-failed-dismiss"),
    );
    assert.equal(skipRow?.action, "skip");
    assert.equal(skipRow?.targetId, "capture-failed-skip");
    assert.equal(skipRow?.threadKind, null);
    assert.equal(skipRow?.contextSource, null);
    assert.equal(skipRow?.targetAuthor, "x");
    assert.equal(dismissRow?.action, "dismiss");
    assert.equal(dismissRow?.targetId, "capture-failed-dismiss");
    assert.equal(dismissRow?.threadKind, null);
    assert.equal(dismissRow?.contextSource, null);
    assert.equal(listScoutEvidence({ userId: a.userId }).length, 2);
  });

  it("POST /api/skipped fails and records no evidence when the evidence table itself is gone", async () => {
    getPlatformDb().exec("DROP TABLE scout_evidence");
    const { status, json } = await call(
      "POST",
      "/api/skipped",
      { threadId: "evidence-failed-skip", author: "@x" },
      a.cookie,
    );
    assert.equal(status, 500);
    assert.equal(json.error, "store_failed");
    assert.deepEqual(await listSkipHistory({ userId: a.userId }), []);
  });

  it("GET /api/expired returns expired + expiredIds", async () => {
    const { handled, status, json } = await call("GET", "/api/expired");
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.expired));
    assert.ok(Array.isArray(json.expiredIds));
  });

  it("GET /api/dismissed strips authorKey from the list", async () => {
    await markDismissed({ threadId: "d1", author: "@d", userId: a.userId });
    const { handled, status, json } = await call(
      "GET",
      "/api/dismissed",
      undefined,
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal((json.dismissals as unknown[]).length, 1);
    assert.deepEqual(json.dismissedIds, ["d1"]);
    for (const row of json.dismissals as Record<string, unknown>[]) {
      assert.equal("authorKey" in row, false);
    }
  });

  it("GET /api/skipped strips authorKey from the list", async () => {
    await markSkipped({ threadId: "s1", author: "@s", userId: a.userId });
    const { handled, status, json } = await call(
      "GET",
      "/api/skipped",
      undefined,
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    assert.equal((json.skipped as unknown[]).length, 1);
    assert.deepEqual(json.skippedIds, ["s1"]);
    for (const row of json.skipped as Record<string, unknown>[]) {
      assert.equal("authorKey" in row, false);
    }
  });

  it("GET without a session returns empty lists, never another user's rows", async () => {
    await markSkipped({ threadId: "s1", author: "@s", userId: a.userId });
    await markDismissed({ threadId: "d1", author: "@d", userId: a.userId });
    await markExpired({ threadId: "e1", author: "@e", userId: a.userId });
    const skipped = await call("GET", "/api/skipped");
    const dismissed = await call("GET", "/api/dismissed");
    const expired = await call("GET", "/api/expired");
    assert.equal(skipped.status, 200);
    assert.deepEqual(skipped.json.skipped, []);
    assert.deepEqual(skipped.json.skippedIds, []);
    assert.deepEqual(dismissed.json.dismissals, []);
    assert.deepEqual(dismissed.json.dismissedIds, []);
    assert.deepEqual(expired.json.expired, []);
    assert.deepEqual(expired.json.expiredIds, []);
  });

  it("POST /api/skipped and /api/dismissed without a session return 401", async () => {
    const body = { threadId: "t1", author: "@x" };
    for (const path of ["/api/skipped", "/api/dismissed"]) {
      const { handled, status, json } = await call("POST", path, body);
      assert.equal(handled, true, path);
      assert.equal(status, 401, path);
      assert.equal(json.error, "unauthenticated", path);
    }
    assert.deepEqual(
      (await call("GET", "/api/skipped", undefined, a.cookie)).json.skippedIds,
      [],
    );
  });

  it("POST writes to the session user only and does not hide the thread for B", async () => {
    const skip = await call(
      "POST",
      "/api/skipped",
      { threadId: "shared", author: "@x", text: "a skipped this" },
      a.cookie,
    );
    assert.equal(skip.status, 200);
    const dismiss = await call(
      "POST",
      "/api/dismissed",
      { threadId: "shared-2", author: "@y", reason: "off topic" },
      a.cookie,
    );
    assert.equal(dismiss.status, 200);

    const aSkipped = await call("GET", "/api/skipped", undefined, a.cookie);
    const bSkipped = await call("GET", "/api/skipped", undefined, b.cookie);
    assert.deepEqual(aSkipped.json.skippedIds, ["shared"]);
    assert.deepEqual(bSkipped.json.skippedIds, []);

    const aDismissed = await call("GET", "/api/dismissed", undefined, a.cookie);
    const bDismissed = await call("GET", "/api/dismissed", undefined, b.cookie);
    assert.deepEqual(aDismissed.json.dismissedIds, ["shared-2"]);
    assert.deepEqual(bDismissed.json.dismissedIds, []);
  });

  it("POST /api/skipped stores conversation ancestry for the session user", async () => {
    const response = await call(
      "POST",
      "/api/skipped",
      {
        threadId: "reply-1",
        author: "@x",
        conversationId: "root-1",
        inReplyToId: "parent-1",
      },
      a.cookie,
    );
    assert.equal(response.status, 200);

    const forA = await call("GET", "/api/skipped", undefined, a.cookie);
    const [row] = forA.json.skipped as Record<string, unknown>[];
    assert.equal(row?.conversationId, "root-1");
    assert.equal(row?.inReplyToId, "parent-1");

    const forB = await call("GET", "/api/skipped", undefined, b.cookie);
    assert.deepEqual(forB.json.skipped, []);
  });

  it("POST /api/skipped prunes the consumed conversation from the tank", async () => {
    await saveScoutCache(
      {
        savedAt: "2026-09-06T00:00:00.000Z",
        queries: ["test"],
        threads: [
          {
            id: "reply-1",
            author: "@x",
            text: "selected",
            url: "https://x.com/x/status/reply-1",
            conversationId: "root-1",
            inReplyToId: "parent-1",
          },
          {
            id: "reply-2",
            author: "@y",
            text: "sibling",
            url: "https://x.com/y/status/reply-2",
            conversationId: "root-1",
          },
          {
            id: "reply-3",
            author: "@z",
            text: "same parent",
            url: "https://x.com/z/status/reply-3",
            inReplyToId: "parent-1",
          },
          {
            id: "other",
            author: "@keep",
            text: "unrelated",
            url: "https://x.com/keep/status/other",
            conversationId: "root-2",
          },
        ],
      },
      { userId: a.userId },
    );

    const response = await call(
      "POST",
      "/api/skipped",
      {
        threadId: "reply-1",
        author: "@x",
        conversationId: "root-1",
        inReplyToId: "parent-1",
      },
      a.cookie,
    );

    assert.equal(response.status, 200);
    assert.deepEqual(
      (await getLastScout({ userId: a.userId }))?.threads.map(
        (thread) => thread.id,
      ),
      ["other"],
    );
  });

  it("GET /api/expired returns only the session user's rows", async () => {
    await markExpired({ threadId: "ea", author: "@a", userId: a.userId });
    await markExpired({ threadId: "eb", author: "@b", userId: b.userId });
    const forA = await call("GET", "/api/expired", undefined, a.cookie);
    const forB = await call("GET", "/api/expired", undefined, b.cookie);
    assert.deepEqual(forA.json.expiredIds, ["ea"]);
    assert.deepEqual(forB.json.expiredIds, ["eb"]);
  });

  it("POST /api/skipped rejects a missing threadId or author", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/skipped",
      { threadId: "t1" },
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("POST /api/dismissed rejects a missing threadId or author", async () => {
    const { handled, status, json } = await call(
      "POST",
      "/api/dismissed",
      { author: "@x" },
      a.cookie,
    );
    assert.equal(handled, true);
    assert.equal(status, 400);
    assert.equal(json.error, "bad_request");
  });

  it("ignores unrelated paths", async () => {
    const { handled, status } = await call("GET", "/api/interacted");
    assert.equal(handled, false);
    assert.equal(status, 0);
  });
});
