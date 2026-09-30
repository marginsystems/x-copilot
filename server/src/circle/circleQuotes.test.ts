import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPlatformDb } from "../db.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import { upsertOwnPost } from "../desk/ownPostStore.ts";
import type { ParsedPostCreate } from "../x-api/xActivity.ts";
import type { xApiGet } from "../x-api/xApi.ts";
import {
  listPendingQuotePosts,
  parseQuoteTargets,
  resolveQuoteTargets,
  type PendingQuotePost,
} from "./circleQuotes.ts";
import { getXProfiles, listCircleLinks } from "./circleStore.ts";

function quotePost(partial: Partial<ParsedPostCreate>): ParsedPostCreate {
  return {
    eventUuid: "evt-q",
    xUserId: "99",
    postId: "q1",
    kind: "quote",
    text: "look",
    postedAt: "2026-09-01T00:00:00.000Z",
    postedAtFallback: false,
    inReplyToId: null,
    inReplyToUserId: null,
    conversationId: "q1",
    authorUsername: "me",
    metrics: {},
    ...partial,
  };
}

const bobUser = {
  id: "7",
  username: "Bob",
  name: "Bob B",
  profile_image_url: "https://pbs.twimg.com/profile_images/7/b_normal.jpg",
};

function pending(partial: Partial<PendingQuotePost>): PendingQuotePost {
  return {
    postId: "q1",
    xUserId: "99",
    quotedPostId: null,
    postedAt: "2026-09-01T00:00:00.000Z",
    ...partial,
  };
}

await describe("circleQuotes", async () => {
  let temp: TempPlatformDb;
  let userId: string;

  beforeEach(() => {
    temp = openTempPlatformDb("x-circle-quotes-");
    userId = seedUser("u-quotes");
    getPlatformDb().prepare(`UPDATE users SET x_username = ? WHERE id = ?`).run("me", userId);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("reads the quoted author from an own-post lookup", () => {
    const parsed = parseQuoteTargets(
      {
        data: [
          { id: "q1", author_id: "99", referenced_tweets: [{ type: "quoted", id: "t1" }] },
          { id: "q2", author_id: "99", referenced_tweets: [{ type: "quoted", id: "t2" }] },
        ],
        includes: {
          tweets: [
            { id: "t1", author_id: "7" },
            { id: "t2", author_id: "99" },
          ],
          users: [bobUser, { id: "99", username: "me" }],
        },
      },
      [pending({}), pending({ postId: "q2" }), pending({ postId: "q3" })],
      "2026-09-30T00:00:00.000Z",
    );
    assert.deepEqual(parsed.links, [
      { postId: "q1", authorKey: "bob", kind: "quote", at: "2026-09-01T00:00:00.000Z" },
    ]);
    assert.deepEqual(parsed.profiles.map((p) => p.handle), ["Bob"]);
  });

  await it("reads the quoted author from a quoted-post lookup", () => {
    const parsed = parseQuoteTargets(
      { data: [{ id: "t1", author_id: "7" }], includes: { users: [bobUser] } },
      [pending({ quotedPostId: "t1" })],
      "2026-09-30T00:00:00.000Z",
    );
    assert.deepEqual(parsed.links.map((l) => [l.postId, l.authorKey]), [["q1", "bob"]]);
  });

  await it("stores the quoted post id from the webhook and resolves every pending quote once", async () => {
    const tenantId = ensureUserTenant(userId);
    upsertOwnPost({ parsed: quotePost({ quotedPostId: "t1" }), userId, tenantId });
    upsertOwnPost({ parsed: quotePost({ postId: "q2", eventUuid: "evt-q2" }), userId, tenantId });
    upsertOwnPost({
      parsed: quotePost({ postId: "r1", eventUuid: "evt-r1", kind: "reply" }),
      userId,
      tenantId,
    });
    assert.deepEqual(
      listPendingQuotePosts(userId, 10).map((p) => [p.postId, p.quotedPostId]),
      [["q2", null], ["q1", "t1"]],
    );
    const calls: Record<string, string | undefined>[] = [];
    const fetchTweets: typeof xApiGet = (opts) => {
      calls.push({ path: opts.path, ...opts.query });
      return Promise.resolve({
        ok: true,
        status: 200,
        json: {
          data: [
            { id: "q2", author_id: "99", referenced_tweets: [{ type: "quoted", id: "t2" }] },
            { id: "t1", author_id: "7" },
          ],
          includes: { tweets: [{ id: "t2", author_id: "7" }], users: [bobUser] },
        },
      });
    };
    const nowMs = Date.parse("2026-09-30T00:00:00.000Z");
    const first = await resolveQuoteTargets({ userId, nowMs, fetchTweets });
    assert.deepEqual(first, { checked: 2, linked: 2, failed: false });
    assert.deepEqual(calls, [
      {
        path: "/tweets",
        ids: "q2,t1",
        expansions: "author_id,referenced_tweets.id.author_id",
        "tweet.fields": "author_id,referenced_tweets",
        "user.fields": "username,name,profile_image_url",
      },
    ]);
    assert.deepEqual(
      listCircleLinks(userId).map((l) => [l.postId, l.authorKey, l.kind]),
      [["q2", "bob", "quote"], ["q1", "bob", "quote"]],
    );
    assert.equal(getXProfiles(["bob"]).get("bob")?.name, "Bob B");
    const second = await resolveQuoteTargets({ userId, nowMs, fetchTweets });
    assert.deepEqual(second, { checked: 0, linked: 0, failed: false });
    assert.equal(calls.length, 1);
  });

  await it("does not retry a quote whose target X no longer returns", async () => {
    const tenantId = ensureUserTenant(userId);
    upsertOwnPost({ parsed: quotePost({ quotedPostId: "gone" }), userId, tenantId });
    const fetchTweets: typeof xApiGet = () =>
      Promise.resolve({ ok: true, status: 200, json: { errors: [{ resource_id: "gone" }] } });
    const result = await resolveQuoteTargets({ userId, nowMs: 0, fetchTweets });
    assert.deepEqual(result, { checked: 1, linked: 0, failed: false });
    assert.deepEqual(listPendingQuotePosts(userId, 10), []);
  });

  await it("checks a quote once when a successful lookup has no target data", async () => {
    const tenantId = ensureUserTenant(userId);
    upsertOwnPost({ parsed: quotePost({ quotedPostId: "missing" }), userId, tenantId });
    upsertOwnPost({ parsed: quotePost({ postId: "q2", eventUuid: "evt-q2" }), userId, tenantId });
    const fetchTweets: typeof xApiGet = () =>
      Promise.resolve({ ok: true, status: 200, json: {} });
    const result = await resolveQuoteTargets({ userId, nowMs: 0, fetchTweets });
    assert.deepEqual(result, { checked: 2, linked: 0, failed: false });
    assert.deepEqual(listPendingQuotePosts(userId, 10), []);
  });

  await it("permanently checks self-quotes and targets without included users", async () => {
    const tenantId = ensureUserTenant(userId);
    upsertOwnPost({ parsed: quotePost({ quotedPostId: "self" }), userId, tenantId });
    upsertOwnPost({
      parsed: quotePost({ postId: "q2", eventUuid: "evt-q2", quotedPostId: "unknown-user" }),
      userId,
      tenantId,
    });
    const fetchTweets: typeof xApiGet = () =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: {
          data: [
            { id: "self", author_id: "99" },
            { id: "unknown-user", author_id: "7" },
          ],
          includes: { users: [{ id: "99", username: "me" }] },
        },
      });
    const result = await resolveQuoteTargets({ userId, nowMs: 0, fetchTweets });
    assert.deepEqual(result, { checked: 2, linked: 0, failed: false });
    assert.deepEqual(listPendingQuotePosts(userId, 10), []);
  });

  await it("leaves quotes pending when the lookup fails", async () => {
    const tenantId = ensureUserTenant(userId);
    upsertOwnPost({ parsed: quotePost({}), userId, tenantId });
    const fetchTweets: typeof xApiGet = () =>
      Promise.resolve({ ok: false, status: 429, error: "rate_limited", message: "slow down" });
    const result = await resolveQuoteTargets({ userId, nowMs: 0, fetchTweets });
    assert.deepEqual(result, { checked: 0, linked: 0, failed: true });
    assert.deepEqual(listPendingQuotePosts(userId, 10).map((p) => p.postId), ["q1"]);
  });

  await it("splits a backlog into batches of 100 and caps one run", async () => {
    const tenantId = ensureUserTenant(userId);
    for (let i = 0; i < 205; i += 1) {
      upsertOwnPost({
        parsed: quotePost({ postId: `q${i}`, eventUuid: `evt-${i}` }),
        userId,
        tenantId,
      });
    }
    const sizes: number[] = [];
    const fetchTweets: typeof xApiGet = (opts) => {
      sizes.push(String(opts.query?.ids).split(",").length);
      return Promise.resolve({ ok: true, status: 200, json: {} });
    };
    const result = await resolveQuoteTargets({ userId, nowMs: 0, maxBatches: 2, fetchTweets });
    assert.deepEqual(sizes, [100, 100]);
    assert.equal(result.checked, 200);
    assert.equal(listPendingQuotePosts(userId, 500).length, 5);
  });
});
