import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { getPlatformDb } from "../db.ts";
import { watchThread } from "../desk/ownPostStore.ts";
import { pruneThreadsFromScoutCache, saveScoutCache } from "./scoutCache.ts";
import {
  captureScoutTargetContext,
  cardContextFromSnapshot,
  MAX_RETAINED_TARGET_CONTEXT,
  normalizeEvidenceAuthor,
  readRetainedContextByConversation,
  readRetainedTargetContext,
  retainScoutContextForTarget,
  retainScoutTargetContext,
  tokenizeScoutTopics,
} from "./scoutEvidenceContext.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("tokenizeScoutTopics", () => {
  it("lowercases, drops urls/handles/stop words/numbers, dedupes, bounds", () => {
    const tokens = tokenizeScoutTopics(
      "The Fed's RATE decision https://x.com/a/status/123 @jerome and inflation, inflation again 2026 via www.example.com/x ok",
    );
    assert.deepEqual(tokens, ["fed's", "rate", "decision", "inflation"]);
  });

  it("is deterministic, order-preserving and capped at twelve tokens", () => {
    const text = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const a = tokenizeScoutTopics(text);
    const b = tokenizeScoutTopics(text);
    assert.deepEqual(a, b);
    assert.equal(a.length, 12);
    assert.equal(a[0], "word0");
  });

  it("bounds input to 2,000 characters and token length to 3–32", () => {
    const filler = "aa ".repeat(700);
    const tokens = tokenizeScoutTopics(`${filler}zzz ${"y".repeat(40)} tail`);
    assert.equal(tokens.includes("tail"), false);
    assert.equal(tokens.includes("y".repeat(40)), false);
    assert.equal(tokens.includes("aa"), false);
    assert.deepEqual(tokenizeScoutTopics(""), []);
    assert.deepEqual(tokenizeScoutTopics(null), []);
  });

  it("keeps unicode words", () => {
    assert.deepEqual(tokenizeScoutTopics("Zölle über Größe"), ["zölle", "über", "größe"]);
  });
});

describe("normalizeEvidenceAuthor", () => {
  it("normalizes handles and rejects placeholders and numeric ids", () => {
    assert.equal(normalizeEvidenceAuthor("@Alice_X"), "alice_x");
    assert.equal(normalizeEvidenceAuthor("bob"), "bob");
    assert.equal(normalizeEvidenceAuthor("@unknown"), null);
    assert.equal(normalizeEvidenceAuthor("@1234567890"), null);
    assert.equal(normalizeEvidenceAuthor(""), null);
    assert.equal(normalizeEvidenceAuthor(null), null);
    assert.equal(normalizeEvidenceAuthor("way-too-long-handle-name"), null);
  });
});

function card(overrides: Partial<ThreadCard> & { id: string }): ThreadCard {
  return {
    author: "@alice",
    text: "Rates and inflation outlook",
    url: `https://x.com/alice/status/${overrides.id}`,
    ...overrides,
  };
}

describe("cardContextFromSnapshot", () => {
  const snapshot = {
    savedAt: "2026-09-20T00:00:00.000Z",
    queries: [],
    threads: [
      card({ id: "c1", threadKind: "fact_add", conversationId: "root1" }),
      card({ id: "c2", threadKind: "timely_take", conversationId: "root2", author: "@bob" }),
      card({ id: "c3", threadKind: "bare_news", conversationId: "root2", author: "@carol" }),
    ],
  };

  it("prefers the exact card and keeps the actual target", () => {
    const ctx = cardContextFromSnapshot(snapshot, { targetId: "c1" });
    assert.equal(ctx?.cardId, "c1");
    assert.equal(ctx?.targetId, "c1");
    assert.equal(ctx?.threadKind, "fact_add");
    assert.equal(ctx?.targetAuthor, "alice");
    assert.deepEqual(ctx?.topics, ["rates", "inflation", "outlook"]);
    assert.equal(ctx?.contextSource, "scout_cache");
  });

  it("falls back to an unambiguous conversation match only", () => {
    const one = cardContextFromSnapshot(snapshot, {
      targetId: "reply-in-root1",
      conversationId: "root1",
    });
    assert.equal(one?.cardId, "c1");
    assert.equal(one?.targetId, "reply-in-root1");
    const ambiguous = cardContextFromSnapshot(snapshot, {
      targetId: "reply-in-root2",
      conversationId: "root2",
    });
    assert.equal(ambiguous, null);
    assert.equal(cardContextFromSnapshot(null, { targetId: "c1" }), null);
    assert.equal(cardContextFromSnapshot(snapshot, { targetId: "zzz" }), null);
  });
});

describe("retained target context", () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-scout-evidence-ctx-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  it("survives tank prune and does not replace a known kind", async () => {
    await saveScoutCache(
      {
        savedAt: "2026-09-20T00:00:00.000Z",
        queries: [],
        threads: [card({ id: "c1", threadKind: "lived_answer", conversationId: "root1" })],
      },
      { userId },
    );
    const retained = await retainScoutContextForTarget({
      userId,
      targetId: "c1",
      fallbackAuthor: "@spoofed",
      source: "lock",
    });
    assert.equal(retained?.threadKind, "lived_answer");
    assert.equal(retained?.author, "alice");
    assert.equal(retained?.contextSource, "scout_cache");

    await pruneThreadsFromScoutCache(["c1"], { userId });
    const again = await retainScoutContextForTarget({
      userId,
      targetId: "c1",
      fallbackAuthor: "@spoofed",
      source: "watch",
    });
    assert.equal(again?.threadKind, "lived_answer");
    assert.equal(again?.author, "alice");
    const captured = await captureScoutTargetContext({ userId, targetId: "c1" });
    assert.equal(captured?.threadKind, "lived_answer");
    assert.equal(captured?.contextSource, "retained");
    assert.equal(readRetainedTargetContext("user-b", "c1"), null);
  });

  it("keeps a missing kind unknown when the card was never in the tank", async () => {
    const retained = await retainScoutContextForTarget({
      userId,
      targetId: "organic-1",
      fallbackAuthor: "@dave",
      fallbackText: "Chips and export controls",
      source: "watch",
    });
    assert.equal(retained?.threadKind, null);
    assert.equal(retained?.author, "dave");
    assert.deepEqual(retained?.topics, ["chips", "export", "controls"]);
    assert.equal(retained?.contextSource, "watch");
    const direct = retainScoutTargetContext({
      userId,
      targetId: "organic-1",
      threadKind: "other",
      contextSource: "scout_cache",
    });
    assert.equal(direct?.threadKind, "other");
  });

  it("uses conversation fallback only when one retained card matches", async () => {
    retainScoutTargetContext({
      userId,
      targetId: "c1",
      cardId: "c1",
      conversationId: "root1",
      threadKind: "fact_add",
      contextSource: "scout_cache",
    });
    assert.equal(
      readRetainedContextByConversation(userId, "root1")?.threadKind,
      "fact_add",
    );
    retainScoutTargetContext({
      userId,
      targetId: "c9",
      cardId: "c9",
      conversationId: "root1",
      threadKind: "bare_news",
      contextSource: "scout_cache",
    });
    assert.equal(readRetainedContextByConversation(userId, "root1"), null);
    const captured = await captureScoutTargetContext({
      userId,
      targetId: "reply-x",
      conversationId: "root1",
    });
    assert.equal(captured, null);
  });

  it("checks older retained cards before accepting a conversation fallback", () => {
    retainScoutTargetContext({
      userId,
      targetId: "new-1",
      cardId: "card-a",
      conversationId: "root-many",
      contextSource: "scout_cache",
      nowMs: 3,
    });
    retainScoutTargetContext({
      userId,
      targetId: "new-2",
      cardId: "card-a",
      conversationId: "root-many",
      contextSource: "scout_cache",
      nowMs: 2,
    });
    retainScoutTargetContext({
      userId,
      targetId: "old-1",
      cardId: "card-b",
      conversationId: "root-many",
      contextSource: "scout_cache",
      nowMs: 1,
    });
    assert.equal(readRetainedContextByConversation(userId, "root-many"), null);
  });

  it("ignores retained targets without a card when resolving a conversation", () => {
    retainScoutTargetContext({
      userId,
      targetId: "card-a",
      cardId: "card-a",
      conversationId: "root-known",
      threadKind: "fact_add",
      contextSource: "scout_cache",
    });
    retainScoutTargetContext({
      userId,
      targetId: "reply-a",
      conversationId: "root-known",
      contextSource: "watch",
    });
    assert.equal(
      readRetainedContextByConversation(userId, "root-known")?.cardId,
      "card-a",
    );
  });

  it("caps retained context per user", () => {
    for (let i = 0; i <= MAX_RETAINED_TARGET_CONTEXT; i++) {
      retainScoutTargetContext({
        userId,
        targetId: `target-${i}`,
        contextSource: "watch",
        nowMs: i,
      });
    }
    const row = getPlatformDb()
      .prepare(
        "SELECT COUNT(*) AS count FROM scout_target_context WHERE user_id = ?",
      )
      .get(userId) as { count: number };
    assert.equal(row.count, MAX_RETAINED_TARGET_CONTEXT);
  });

  it("falls back to the watch list for author only", async () => {
    watchThread({ userId, threadId: "w1", author: "@erin", text: "GPU pricing" });
    const captured = await captureScoutTargetContext({ userId, targetId: "w1" });
    assert.equal(captured?.threadKind, null);
    assert.equal(captured?.targetAuthor, "erin");
    assert.deepEqual(captured?.topics, ["gpu", "pricing"]);
    assert.equal(captured?.contextSource, "watch");
    assert.equal(await captureScoutTargetContext({ userId, targetId: "none" }), null);
  });
});
