import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBlockedConversationIds,
  getDismissedConversationIds,
  listDismissalHistory,
  markDismissed,
} from "./dismissalStore.ts";
import {
  markInteracted,
  threadMatchesConversationIds,
} from "./interactionStore.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("markDismissed / listDismissalHistory", () => {
  let dir: string;
  let storePath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "x-copilot-dismiss-"));
    storePath = join(dir, "dismissals.json");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("persists reason and lists newest first", async () => {
    const t1 = Date.parse("2026-07-28T10:00:00.000Z");
    const t2 = Date.parse("2026-07-28T11:00:00.000Z");
    await markDismissed({
      threadId: "a",
      author: "@a",
      reason: "off topic",
      nowMs: t1,
      storePath,
    });
    await markDismissed({
      threadId: "b",
      author: "@b",
      nowMs: t2,
      storePath,
    });
    const history = await listDismissalHistory({ storePath });
    assert.deepEqual(
      history.map((d) => d.threadId),
      ["b", "a"],
    );
    assert.equal(history[1]?.reason, "off topic");
  });

  it("persists conversation ancestry and blocks siblings", async () => {
    await markDismissed({
      threadId: "reply-1",
      author: "@victim",
      conversationId: "root-1",
      inReplyToId: "root-1",
      reason: "engagement bait",
      storePath,
    });
    const history = await listDismissalHistory({ storePath });
    assert.equal(history[0]?.conversationId, "root-1");
    assert.equal(history[0]?.inReplyToId, "root-1");

    const blocked = await getDismissedConversationIds({ storePath });
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

  it("unions Marked + Not interested ancestry", async () => {
    const interactionPath = join(dir, "interactions.json");
    await markInteracted({
      threadId: "marked-reply",
      author: "@a",
      conversationId: "convo-marked",
      inReplyToId: "convo-marked",
      storePath: interactionPath,
    });
    await markDismissed({
      threadId: "dismissed-reply",
      author: "@b",
      conversationId: "convo-dismissed",
      inReplyToId: "convo-dismissed",
      storePath,
    });
    const blocked = await getBlockedConversationIds({
      interactionStorePath: interactionPath,
      dismissalStorePath: storePath,
    });
    assert.ok(blocked.has("convo-marked"));
    assert.ok(blocked.has("convo-dismissed"));
    assert.ok(blocked.has("marked-reply"));
    assert.ok(blocked.has("dismissed-reply"));
  });
});
