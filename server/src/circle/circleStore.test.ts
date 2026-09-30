import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { getPlatformDb } from "../db.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import type { ParsedPostCreate } from "../x-api/xActivity.ts";
import {
  circleLinkFromOwnPost,
  circleSelfHandle,
  getXProfiles,
  listCircleLinks,
  recordCircleLinks,
  recordOwnPostCircleLink,
  upsertXProfiles,
} from "./circleStore.ts";

function ownPost(partial: Partial<ParsedPostCreate>): ParsedPostCreate {
  return {
    eventUuid: "evt-1",
    xUserId: "99",
    postId: "p1",
    kind: "reply",
    text: "hi",
    postedAt: "2026-09-01T00:00:00.000Z",
    postedAtFallback: false,
    inReplyToId: "t1",
    inReplyToUserId: "77",
    inReplyToUsername: "Alice",
    conversationId: "t1",
    authorUsername: "me",
    metrics: {},
    ...partial,
  };
}

await describe("circleStore", async () => {
  let temp: TempPlatformDb;

  beforeEach(() => {
    temp = openTempPlatformDb("x-circle-store-");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  await it("upserts profiles and keeps known fields when a later write lacks them", () => {
    upsertXProfiles([
      {
        authorKey: "alice",
        handle: "Alice",
        name: "Alice A",
        avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
    upsertXProfiles([
      {
        authorKey: "Alice",
        handle: "alice",
        name: null,
        avatarUrl: null,
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
    const profiles = getXProfiles(["@ALICE", "nobody"]);
    assert.deepEqual([...profiles.values()], [
      {
        authorKey: "alice",
        handle: "alice",
        name: "Alice A",
        avatarUrl: "https://pbs.twimg.com/a_400x400.jpg",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ]);
  });

  await it("records links once per post and skips the user's own handle", () => {
    const userId = seedUser("u-circle");
    getPlatformDb().prepare(`UPDATE users SET x_username = ? WHERE id = ?`).run("Me", userId);
    assert.equal(circleSelfHandle(userId), "Me");
    const inserted = recordCircleLinks(userId, [
      { postId: "p1", authorKey: "@Bob", kind: "reply", at: "2026-09-01T00:00:00.000Z" },
      { postId: "p1", authorKey: "bob", kind: "quote", at: "2026-09-01T00:00:00.000Z" },
      { postId: "p2", authorKey: "me", kind: "reply", at: "2026-09-02T00:00:00.000Z" },
      { postId: "p3", authorKey: "carol", kind: "quote", at: "2026-09-03T00:00:00.000Z" },
    ]);
    assert.equal(inserted, 2);
    assert.equal(
      recordCircleLinks(userId, [
        { postId: "p3", authorKey: "carol", kind: "quote", at: "2026-09-03T00:00:00.000Z" },
      ]),
      0,
    );
    assert.deepEqual(listCircleLinks(userId), [
      { postId: "p3", authorKey: "carol", kind: "quote", at: "2026-09-03T00:00:00.000Z" },
      { postId: "p1", authorKey: "bob", kind: "reply", at: "2026-09-01T00:00:00.000Z" },
    ]);
    assert.deepEqual(listCircleLinks("someone-else"), []);
    assert.deepEqual(listCircleLinks(userId, 1).map((link) => link.postId), ["p3"]);
  });

  await it("never stores author keys the circle would drop", () => {
    const userId = seedUser("u-circle-bad-keys");
    assert.equal(
      recordCircleLinks(userId, [
        { postId: "p1", authorKey: "@unknown", kind: "reply", at: "2026-09-01T00:00:00.000Z" },
        { postId: "p2", authorKey: "123456789", kind: "reply", at: "2026-09-01T00:00:00.000Z" },
      ]),
      0,
    );
    assert.equal(
      recordCircleLinks(userId, [
        { postId: "p1", authorKey: "alice", kind: "reply", at: "2026-09-01T00:00:00.000Z" },
      ]),
      1,
    );
    assert.deepEqual(listCircleLinks(userId).map((link) => link.authorKey), ["alice"]);
  });

  await it("derives a reply link from an own post only when the target is someone else", () => {
    assert.deepEqual(circleLinkFromOwnPost(ownPost({})), {
      postId: "p1",
      authorKey: "alice",
      kind: "reply",
      at: "2026-09-01T00:00:00.000Z",
    });
    assert.equal(circleLinkFromOwnPost(ownPost({ inReplyToUserId: "99" })), null);
    assert.equal(circleLinkFromOwnPost(ownPost({ inReplyToUsername: null })), null);
    assert.equal(circleLinkFromOwnPost(ownPost({ kind: "original" })), null);
    const userId = seedUser("u-own-post");
    recordOwnPostCircleLink(userId, ownPost({}));
    assert.deepEqual(listCircleLinks(userId).map((l) => l.authorKey), ["alice"]);
  });
});
