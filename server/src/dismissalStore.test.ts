import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getBlockedConversationIds,
  getDismissedConversationIds,
  getDismissedThreadIds,
  listDismissalHistory,
  markDismissed,
} from "./dismissalStore.ts";
import { markInteracted } from "./interactionStore.ts";
import { threadMatchesConversationIds } from "./interactionCooldown.ts";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("markDismissed / listDismissalHistory", () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-copilot-dismiss-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  it("persists reason and lists newest first", async () => {
    const t1 = Date.parse("2026-07-28T10:00:00.000Z");
    const t2 = Date.parse("2026-07-28T11:00:00.000Z");
    await markDismissed({
      threadId: "a",
      author: "@a",
      userId,
      reason: "off topic",
      nowMs: t1,
    });
    await markDismissed({
      threadId: "b",
      author: "@b",
      userId,
      nowMs: t2,
    });
    const history = await listDismissalHistory({ userId });
    assert.deepEqual(
      history.map((d) => d.threadId),
      ["b", "a"],
    );
    assert.equal(history[1]?.reason, "off topic");
  });

  it("requires a userId", async () => {
    await assert.rejects(
      () => markDismissed({ threadId: "a", author: "@a", userId: "" }),
      /userId is required/,
    );
  });

  it("persists conversation ancestry and blocks siblings", async () => {
    await markDismissed({
      threadId: "reply-1",
      author: "@victim",
      userId,
      conversationId: "root-1",
      inReplyToId: "root-1",
      reason: "engagement bait",
    });
    const history = await listDismissalHistory({ userId });
    assert.equal(history[0]?.conversationId, "root-1");
    assert.equal(history[0]?.inReplyToId, "root-1");

    const blocked = await getDismissedConversationIds({ userId });
    assert.ok(blocked.has("root-1"));
    assert.ok(blocked.has("reply-1"));

    const sibling: ThreadCard = {
      id: "reply-2",
      author: "@other",
      text: "sibling under same bait OP",
      url: "https://x.com/other/status/reply-2",
      conversationId: "root-1",
      inReplyToId: "root-1",
      isReply: true,
    };
    assert.equal(threadMatchesConversationIds(sibling, blocked), true);
  });

  it("keeps prior ancestry when re-dismissed without it", async () => {
    await markDismissed({
      threadId: "reply-1",
      author: "@victim",
      userId,
      conversationId: "root-1",
    });
    await markDismissed({
      threadId: "reply-1",
      author: "@victim",
      userId,
      reason: "again",
    });
    const [row] = await listDismissalHistory({ userId });
    assert.equal(row?.conversationId, "root-1");
    assert.equal(row?.reason, "again");
  });

  it("unions Marked + Not interested ancestry for one user only", async () => {
    await markInteracted({
      threadId: "marked-reply",
      author: "@a",
      userId,
      conversationId: "convo-marked",
      inReplyToId: "convo-marked",
    });
    await markDismissed({
      threadId: "dismissed-reply",
      author: "@b",
      userId,
      conversationId: "convo-dismissed",
      inReplyToId: "convo-dismissed",
    });
    await markDismissed({
      threadId: "b-dismissed",
      author: "@c",
      userId: "user-b",
      conversationId: "convo-b",
    });
    const blocked = await getBlockedConversationIds({ userId });
    assert.ok(blocked.has("convo-marked"));
    assert.ok(blocked.has("convo-dismissed"));
    assert.ok(blocked.has("marked-reply"));
    assert.ok(blocked.has("dismissed-reply"));
    assert.equal(blocked.has("convo-b"), false);
    assert.equal(blocked.has("b-dismissed"), false);

    const blockedB = await getBlockedConversationIds({ userId: "user-b" });
    assert.ok(blockedB.has("convo-b"));
    assert.equal(blockedB.has("convo-marked"), false);
  });

  it("does not hide a thread A dismissed from B", async () => {
    await markDismissed({ threadId: "shared", author: "@a", userId });
    assert.equal((await getDismissedThreadIds({ userId })).has("shared"), true);
    assert.equal(
      (await getDismissedThreadIds({ userId: "user-b" })).has("shared"),
      false,
    );
    assert.deepEqual(await listDismissalHistory({ userId: "user-b" }), []);
  });
});
