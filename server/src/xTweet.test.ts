import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { postUserReply } from "./xTweet.ts";

describe("postUserReply", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-tweet-"));
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

  it("rejects an empty reply without calling X", async () => {
    let calls = 0;
    const got = await postUserReply({
      consumerKey: "k",
      consumerSecret: "s",
      accessToken: "at",
      accessTokenSecret: "as",
      text: "   ",
      inReplyToId: "123",
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    });
    assert.equal(got.ok, false);
    if (got.ok) return;
    assert.equal(got.error, "empty");
    assert.equal(calls, 0);
  });

  it("rejects a non-numeric parent id", async () => {
    const got = await postUserReply({
      consumerKey: "k",
      consumerSecret: "s",
      accessToken: "at",
      accessTokenSecret: "as",
      text: "hello",
      inReplyToId: "abc",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    });
    assert.equal(got.ok, false);
    if (got.ok) return;
    assert.equal(got.error, "bad_parent");
  });

  it("posts JSON as a reply and returns the tweet id", async () => {
    let body = "";
    const got = await postUserReply({
      consumerKey: "k",
      consumerSecret: "s",
      accessToken: "at",
      accessTokenSecret: "as",
      text: "the loop is the tax",
      inReplyToId: "42",
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        assert.equal(init?.method, "POST");
        assert.match(String(init?.headers?.["Authorization"] ?? ""), /^OAuth /);
        return new Response(JSON.stringify({ data: { id: "99" } }), {
          status: 201,
        });
      },
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.tweetId, "99");
    assert.deepEqual(JSON.parse(body), {
      text: "the loop is the tax",
      reply: { in_reply_to_tweet_id: "42" },
    });
  });

  it("surfaces an X refusal", async () => {
    const got = await postUserReply({
      consumerKey: "k",
      consumerSecret: "s",
      accessToken: "at",
      accessTokenSecret: "as",
      text: "hello",
      inReplyToId: "42",
      fetchImpl: async () =>
        new Response(JSON.stringify({ title: "Forbidden", detail: "Read-only" }), {
          status: 403,
        }),
    });
    assert.equal(got.ok, false);
    if (got.ok) return;
    assert.equal(got.status, 403);
    assert.equal(got.message, "Read-only");
  });
});
