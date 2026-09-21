import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { getPlatformDb } from "../db.ts";
import {
  explicitEventKey,
  findScoutTakeByReplyId,
  getScoutEvidence,
  listScoutEvidence,
  readScoutEvidenceCursor,
  readScoutEvidenceRevision,
  recordScoutEvidence,
  setScoutEvidenceNoteState,
  takeEventKey,
  writeScoutEvidenceCursor,
} from "./scoutEvidence.ts";

const T0 = Date.parse("2026-09-20T10:00:00.000Z");

describe("scoutEvidence identities", () => {
  it("builds stable take and explicit keys", () => {
    assert.equal(takeEventKey(" 555 "), "reply:555");
    assert.equal(explicitEventKey("skip", "scout", "card-1"), "skip:scout:card-1");
    assert.equal(
      explicitEventKey("dismiss", "for-you", "sug-1"),
      "dismiss:for-you:sug-1",
    );
    assert.throws(() => takeEventKey(""));
    assert.throws(() => explicitEventKey("skip", "scout", " "));
  });
});

describe("recordScoutEvidence", () => {
  let temp: TempPlatformDb;
  const userId = "user-a";

  beforeEach(() => {
    temp = openTempPlatformDb("x-scout-evidence-");
    seedUser(userId);
    seedUser("user-b");
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
  });

  it("one confirmed reply across adapters yields one take and one revision bump", () => {
    const first = recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r1"),
      action: "take",
      source: "voice",
      targetId: "t1",
      replyId: "r1",
      actedAt: new Date(T0).toISOString(),
      threadKind: "fact_add",
      targetAuthor: "alice",
      topics: ["rates", "inflation"],
      contextSource: "scout_cache",
      nowMs: T0,
    });
    assert.equal(first.changed, true);
    assert.equal(first.row.revision, 1);

    // Webhook redelivery of the same reply: no change, no revision bump.
    const webhook = recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r1"),
      action: "take",
      source: "webhook",
      targetId: "t1",
      replyId: "r1",
      actedAt: new Date(T0 + 60_000).toISOString(),
      nowMs: T0 + 60_000,
    });
    assert.equal(webhook.changed, false);
    assert.equal(webhook.row.actedAt, new Date(T0).toISOString());
    assert.equal(webhook.row.source, "voice");
    const discovery = recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r1"),
      action: "take",
      source: "discovery",
      targetId: "t1",
      replyId: "r1",
      actedAt: new Date(T0 + 3_600_000).toISOString(),
      nowMs: T0 + 3_600_000,
    });
    assert.equal(discovery.changed, false);
    assert.equal(listScoutEvidence({ userId }).length, 1);
    assert.equal(readScoutEvidenceRevision(userId).revision, 1);
    assert.equal(
      readScoutEvidenceRevision(userId).updatedAt,
      new Date(T0).toISOString(),
    );
    assert.equal(findScoutTakeByReplyId(userId, "r1")?.eventKey, "reply:r1");
  });

  it("requires a confirmed reply id for a take and a matching key", () => {
    assert.throws(() =>
      recordScoutEvidence({
        userId,
        eventKey: "reply:x",
        action: "take",
        source: "manual",
        targetId: "t",
        actedAt: new Date(T0).toISOString(),
      }),
    );
    assert.throws(() =>
      recordScoutEvidence({
        userId,
        eventKey: "reply:other",
        action: "take",
        source: "manual",
        targetId: "t",
        replyId: "r9",
        actedAt: new Date(T0).toISOString(),
      }),
    );
    assert.throws(() =>
      recordScoutEvidence({
        userId: "  ",
        eventKey: "skip:scout:c",
        action: "skip",
        source: "scout",
        targetId: "c",
        actedAt: new Date(T0).toISOString(),
      }),
    );
  });

  it("isolates the same target for different users", () => {
    for (const id of [userId, "user-b"]) {
      recordScoutEvidence({
        userId: id,
        eventKey: explicitEventKey("skip", "scout", "shared"),
        action: "skip",
        source: "scout",
        targetId: "shared",
        actedAt: new Date(T0).toISOString(),
        threadKind: id === userId ? "hollow_ask" : null,
        nowMs: T0,
      });
    }
    assert.equal(listScoutEvidence({ userId }).length, 1);
    assert.equal(listScoutEvidence({ userId: "user-b" }).length, 1);
    assert.equal(getScoutEvidence(userId, "skip:scout:shared")?.threadKind, "hollow_ask");
    assert.equal(getScoutEvidence("user-b", "skip:scout:shared")?.threadKind, null);
    assert.equal(readScoutEvidenceRevision(userId).revision, 1);
    assert.equal(readScoutEvidenceRevision("user-b").revision, 1);
  });

  it("enrichment fills unknown facts but never replaces a known kind or the action time", () => {
    const key = explicitEventKey("dismiss", "scout", "c1");
    recordScoutEvidence({
      userId,
      eventKey: key,
      action: "dismiss",
      source: "scout",
      targetId: "c1",
      actedAt: new Date(T0).toISOString(),
      nowMs: T0,
    });
    const filled = recordScoutEvidence({
      userId,
      eventKey: key,
      action: "dismiss",
      source: "reconcile",
      targetId: "c1",
      actedAt: new Date(T0 + 5000).toISOString(),
      threadKind: "sharp_opinion",
      targetAuthor: "bob",
      topics: ["tariffs"],
      contextSource: "retained",
      nowMs: T0 + 5000,
    });
    assert.equal(filled.changed, true);
    assert.equal(filled.row.threadKind, "sharp_opinion");
    assert.equal(filled.row.targetAuthor, "bob");
    assert.deepEqual(filled.row.topics, ["tariffs"]);
    assert.equal(filled.row.contextSource, "retained");
    assert.equal(filled.row.actedAt, new Date(T0).toISOString());
    assert.equal(filled.row.revision, 2);

    const conflicting = recordScoutEvidence({
      userId,
      eventKey: key,
      action: "dismiss",
      source: "reconcile",
      targetId: "c1",
      actedAt: new Date(T0).toISOString(),
      threadKind: "bare_news",
      targetAuthor: "mallory",
      topics: ["other"],
      nowMs: T0 + 9000,
    });
    assert.equal(conflicting.changed, false);
    assert.equal(conflicting.row.threadKind, "sharp_opinion");
    assert.equal(conflicting.row.targetAuthor, "bob");
    const unknown = recordScoutEvidence({
      userId,
      eventKey: key,
      action: "dismiss",
      source: "reconcile",
      targetId: "c1",
      actedAt: new Date(T0).toISOString(),
      threadKind: null,
      nowMs: T0 + 9000,
    });
    assert.equal(unknown.changed, false);
    assert.equal(readScoutEvidenceRevision(userId).revision, 2);
  });

  it("stores unknown kinds as null, never as other", () => {
    const row = recordScoutEvidence({
      userId,
      eventKey: explicitEventKey("skip", "scout", "c2"),
      action: "skip",
      source: "scout",
      targetId: "c2",
      actedAt: new Date(T0).toISOString(),
      threadKind: "nonsense" as unknown as "other",
    }).row;
    assert.equal(row.threadKind, null);
    const other = recordScoutEvidence({
      userId,
      eventKey: explicitEventKey("skip", "scout", "c3"),
      action: "skip",
      source: "scout",
      targetId: "c3",
      actedAt: new Date(T0).toISOString(),
      threadKind: "other",
    }).row;
    assert.equal(other.threadKind, "other");
  });

  it("keeps raw skip evidence when a later take arrives for the same target", () => {
    recordScoutEvidence({
      userId,
      eventKey: explicitEventKey("skip", "scout", "c4"),
      action: "skip",
      source: "scout",
      targetId: "c4",
      actedAt: new Date(T0).toISOString(),
      nowMs: T0,
    });
    recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r4"),
      action: "take",
      source: "manual",
      targetId: "c4",
      replyId: "r4",
      actedAt: new Date(T0 + 10_000).toISOString(),
      nowMs: T0 + 10_000,
    });
    const rows = listScoutEvidence({ userId });
    assert.deepEqual(
      rows.map((r) => [r.action, r.eventKey]),
      [
        ["skip", "skip:scout:c4"],
        ["take", "reply:r4"],
      ],
    );
    assert.equal(readScoutEvidenceRevision(userId).revision, 2);
    assert.equal(readScoutEvidenceRevision(userId).lastEventKey, "reply:r4");
  });

  it("bounds topics to twelve deduped tokens", () => {
    const topics = Array.from({ length: 20 }, (_, i) => `topic${i}`);
    const row = recordScoutEvidence({
      userId,
      eventKey: explicitEventKey("skip", "scout", "c5"),
      action: "skip",
      source: "scout",
      targetId: "c5",
      actedAt: new Date(T0).toISOString(),
      topics: [...topics, "topic0"],
    }).row;
    assert.equal(row.topics.length, 12);
    assert.equal(new Set(row.topics).size, 12);
  });

  it("persists context-source-only enrichment", () => {
    recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r-context"),
      action: "take",
      source: "webhook",
      targetId: "t-context",
      replyId: "r-context",
      actedAt: new Date(T0).toISOString(),
      threadKind: "fact_add",
      nowMs: T0,
    });
    const result = recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r-context"),
      action: "take",
      source: "reconcile",
      targetId: "t-context",
      replyId: "r-context",
      actedAt: new Date(T0).toISOString(),
      contextSource: "watch",
      nowMs: T0 + 1,
    });
    assert.equal(result.changed, true);
    assert.equal(result.row.contextSource, "watch");
  });

  it("note verification advances the revision only when the state changes", () => {
    recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r6"),
      action: "take",
      source: "webhook",
      targetId: "t6",
      replyId: "r6",
      actedAt: new Date(T0).toISOString(),
      nowMs: T0,
    });
    assert.equal(getScoutEvidence(userId, "reply:r6")?.noteState, "unknown");
    assert.equal(
      setScoutEvidenceNoteState({ userId, replyId: "r6", state: "stored", nowMs: T0 + 1 }),
      true,
    );
    assert.equal(
      setScoutEvidenceNoteState({ userId, replyId: "r6", state: "stored", nowMs: T0 + 2 }),
      false,
    );
    assert.equal(
      setScoutEvidenceNoteState({ userId, replyId: "nope", state: "stored" }),
      false,
    );
    const row = getScoutEvidence(userId, "reply:r6")!;
    assert.equal(row.noteState, "stored");
    assert.equal(row.noteVerifiedAt, new Date(T0 + 1).toISOString());
    assert.equal(readScoutEvidenceRevision(userId).revision, 2);
    // Recording the same take again with noteState "unknown" leaves it stored.
    const again = recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r6"),
      action: "take",
      source: "discovery",
      targetId: "t6",
      replyId: "r6",
      actedAt: new Date(T0).toISOString(),
      noteState: "unknown",
    });
    assert.equal(again.changed, false);
    assert.equal(again.row.noteState, "stored");
  });

  it("rolls back with the caller's transaction", () => {
    const db = getPlatformDb();
    assert.throws(() =>
      db.transaction(() => {
        recordScoutEvidence({
          userId,
          eventKey: explicitEventKey("skip", "scout", "c7"),
          action: "skip",
          source: "scout",
          targetId: "c7",
          actedAt: new Date(T0).toISOString(),
        });
        throw new Error("boom");
      })(),
    );
    assert.equal(getScoutEvidence(userId, "skip:scout:c7"), null);
    assert.equal(readScoutEvidenceRevision(userId).revision, 0);
  });

  it("stores and clears reconciliation cursors per scope", () => {
    assert.equal(readScoutEvidenceCursor(userId, "interactions"), null);
    writeScoutEvidenceCursor(userId, "interactions", { at: "x", id: "y" });
    assert.deepEqual(readScoutEvidenceCursor(userId, "interactions"), {
      at: "x",
      id: "y",
    });
    assert.equal(readScoutEvidenceCursor("user-b", "interactions"), null);
    writeScoutEvidenceCursor(userId, "interactions", null);
    assert.equal(readScoutEvidenceCursor(userId, "interactions"), null);
  });
});
