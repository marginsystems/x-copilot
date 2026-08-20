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
import { buildTweetCreateBody, postUserReply, postUserTweet } from "./xTweet.ts";

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

describe("buildTweetCreateBody", () => {
  it("builds an original, a quote, or a reply — never a mix", () => {
    assert.deepEqual(buildTweetCreateBody({ text: "hello" }), {
      ok: true,
      body: { text: "hello" },
    });
    assert.deepEqual(
      buildTweetCreateBody({ text: "still true", quoteTweetId: "99" }),
      { ok: true, body: { text: "still true", quote_tweet_id: "99" } },
    );
    assert.deepEqual(
      buildTweetCreateBody({ text: "hey", inReplyToId: "42" }),
      {
        ok: true,
        body: { text: "hey", reply: { in_reply_to_tweet_id: "42" } },
      },
    );
    const mixed = buildTweetCreateBody({
      text: "nope",
      inReplyToId: "1",
      quoteTweetId: "2",
    });
    assert.equal(mixed.ok, false);
    if (!mixed.ok) assert.equal(mixed.error, "mixed_target");
  });
});

describe("postUserTweet", () => {
  let dir: string;

  beforeEach(() => {
    resetPlatformDbForTests();
    dir = mkdtempSync(join(tmpdir(), "x-tweet-compose-"));
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

  it("posts an original without a reply target", async () => {
    let body = "";
    const got = await postUserTweet({
      consumerKey: "k",
      consumerSecret: "s",
      accessToken: "at",
      accessTokenSecret: "as",
      text: "ship the recap",
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        return new Response(JSON.stringify({ data: { id: "77" } }), {
          status: 201,
        });
      },
    });
    assert.equal(got.ok, true);
    if (!got.ok) return;
    assert.equal(got.tweetId, "77");
    assert.deepEqual(JSON.parse(body), { text: "ship the recap" });
  });

  it("posts a quote caption with quote_tweet_id", async () => {
    let body = "";
    const got = await postUserTweet({
      consumerKey: "k",
      consumerSecret: "s",
      accessToken: "at",
      accessTokenSecret: "as",
      text: "still true",
      quoteTweetId: "55",
      fetchImpl: async (_url, init) => {
        body = String(init?.body ?? "");
        return new Response(JSON.stringify({ data: { id: "78" } }), {
          status: 201,
        });
      },
    });
    assert.equal(got.ok, true);
    assert.deepEqual(JSON.parse(body), {
      text: "still true",
      quote_tweet_id: "55",
    });
  });
});
