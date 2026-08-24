import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { upsertOauthUser } from "./oauthAccountStore.ts";
import { SESSION_COOKIE } from "./sessionCookie.ts";
import { createSession } from "./sessionStore.ts";
import { MIN_T24H_SNAPSHOTS } from "./forYouDigest.ts";
import { tryHandleForYou } from "./forYouHttp.ts";
import { patchOwnPostSnapshot, upsertOwnPost } from "./ownPostStore.ts";

describe("GET /api/for-you", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-fyhttp-"));
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

  it("reports how many 24h snapshots are tracked toward the digest", async () => {
    const user = upsertOauthUser({
      provider: "google",
      providerUserId: "gid-fy",
      email: "fy@example.com",
      emailVerified: true,
    });
    for (let i = 1; i <= 3; i++) {
      upsertOwnPost({
        parsed: {
          eventUuid: `evt-${i}`,
          xUserId: "99",
          postId: `p${i}`,
          kind: "original",
          text: `post ${i}`,
          postedAt: "2026-08-15T12:00:00.000Z",
          inReplyToId: null,
          inReplyToUserId: null,
          conversationId: null,
          authorUsername: "desk",
          metrics: { views: 10, likes: 1, replies: 0, retweets: 0, bookmarks: 0 },
        },
        userId: user.id,
        tenantId: "local",
      });
      patchOwnPostSnapshot(`p${i}`, "t24h", {
        views: 80,
        likes: 1,
        replies: 0,
        retweets: 0,
        bookmarks: 0,
      });
    }
    const { token } = createSession(user.id);
    const req = new EventEmitter() as unknown as IncomingMessage;
    Object.assign(req, {
      method: "GET",
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
    const handled = await tryHandleForYou(
      req,
      res,
      new URL("http://localhost/api/for-you"),
    );
    assert.equal(handled, true);
    assert.equal(status, 200);
    const json = JSON.parse(raw) as {
      tracked?: number;
      needed?: number;
      suggestions?: unknown[];
    };
    assert.equal(json.tracked, 3);
    assert.equal(json.needed, MIN_T24H_SNAPSHOTS);
    assert.deepEqual(json.suggestions, []);
  });
});
