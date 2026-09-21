import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import { ensureUserTenant } from "../billing/billingStore.ts";
import {
  listInteractionRowsPage,
  markInteracted,
} from "../desk/interactionStore.ts";
import {
  listConfirmedOwnRepliesPage,
  upsertOwnPost,
} from "../desk/ownPostStore.ts";
import {
  buildOwnedNotePath,
  writeOwnedNoteAtomically,
} from "../memory/ownedMemoryNotes.ts";
import { saveScoutCache } from "./scoutCache.ts";
import {
  findScoutTakeByReplyId,
  listScoutEvidence,
  readScoutEvidenceRevision,
  recordScoutEvidence,
  takeEventKey,
} from "./scoutEvidence.ts";
import { retainScoutTargetContext } from "./scoutEvidenceContext.ts";
import {
  reconcileScoutEvidence,
  verifyOwnedReplyNote,
} from "./scoutEvidenceReconcile.ts";
import type { ParsedPostCreate } from "../x-api/xActivity.ts";

const T0 = Date.parse("2026-09-20T10:00:00.000Z");
const X_USER = "900";

function ownReply(overrides: Partial<ParsedPostCreate> & { postId: string }): ParsedPostCreate {
  return {
    eventUuid: `evt-${overrides.postId}`,
    xUserId: X_USER,
    postId: overrides.postId,
    kind: "reply",
    text: `reply body ${overrides.postId}`,
    postedAt: new Date(T0).toISOString(),
    postedAtFallback: false,
    inReplyToId: "target-1",
    inReplyToUserId: "777",
    conversationId: "root-1",
    authorUsername: "me",
    metrics: {},
    ...overrides,
  };
}

async function writeNote(opts: {
  knowledgeRoot: string;
  userId: string;
  threadId: string;
  at: string;
  reply: string;
  replyId?: string;
}): Promise<string> {
  const path = buildOwnedNotePath({
    kind: "interaction",
    userId: opts.userId,
    threadId: opts.threadId,
    at: opts.at,
    knowledgeRoot: opts.knowledgeRoot,
  });
  const lines = [
    "---",
    "type: interaction",
    `threadId: "${opts.threadId}"`,
    `userId: "${opts.userId}"`,
    `interactedAt: "${opts.at}"`,
  ];
  if (opts.replyId) lines.push(`replyId: "${opts.replyId}"`);
  lines.push("---", "", "## Reply", "", opts.reply, "");
  await writeOwnedNoteAtomically({ path, merge: () => lines.join("\n") });
  return path;
}

describe("reconcileScoutEvidence", () => {
  let temp: TempPlatformDb;
  let knowledgeRoot: string;
  const userId = "user-a";
  let tenantId: string;

  beforeEach(() => {
    temp = openTempPlatformDb("x-scout-evidence-reconcile-");
    knowledgeRoot = mkdtempSync(join(tmpdir(), "x-scout-evidence-notes-"));
    seedUser(userId);
    seedUser("user-b");
    tenantId = ensureUserTenant(userId);
  });

  afterEach(() => {
    closeTempPlatformDb(temp);
    rmSync(knowledgeRoot, { recursive: true, force: true });
  });

  it("resumes tied keyset pages without skipping the boundary's older rows", async () => {
    const at = new Date(T0).toISOString();
    for (const id of ["a", "b", "c"]) {
      await markInteracted({
        threadId: `thread-${id}`,
        author: "@alice",
        userId,
        nowMs: T0,
      });
      upsertOwnPost({
        parsed: ownReply({ postId: `reply-${id}`, postedAt: at }),
        userId,
        tenantId,
      });
    }
    const interactions = listInteractionRowsPage({ userId, limit: 2 });
    const nextInteractions = listInteractionRowsPage({
      userId,
      limit: 2,
      before: {
        at: interactions[1]!.at,
        threadId: interactions[1]!.threadId,
      },
    });
    assert.ok(nextInteractions.some((row) => row.threadId === "thread-a"));

    const replies = listConfirmedOwnRepliesPage({ userId, limit: 2 });
    const nextReplies = listConfirmedOwnRepliesPage({
      userId,
      limit: 2,
      before: { postedAt: replies[1]!.postedAt, id: replies[1]!.id },
    });
    assert.ok(nextReplies.some((row) => row.id === "reply-a"));
  });

  it("does not turn a URL-only mark into a take", async () => {
    await markInteracted({
      threadId: "target-1",
      author: "@alice",
      userId,
      replyId: "r-url-only",
      replyUrl: "https://x.com/me/status/r-url-only",
      nowMs: T0,
    });
    const result = await reconcileScoutEvidence({ userId, knowledgeRoot, nowMs: T0 });
    assert.equal(result.scanned.interactions, 1);
    assert.equal(result.inserted, 0);
    assert.equal(result.complete, true);
    assert.equal(listScoutEvidence({ userId }).length, 0);
  });

  it("confirms a take from own_posts text, then repairs stored-note credit", async () => {
    await saveScoutCache(
      {
        savedAt: new Date(T0).toISOString(),
        queries: [],
        threads: [
          {
            id: "target-1",
            author: "@alice",
            text: "Rates outlook",
            url: "https://x.com/alice/status/target-1",
            threadKind: "fact_add",
            conversationId: "root-1",
          },
        ],
      },
      { userId },
    );
    await markInteracted({
      threadId: "target-1",
      author: "@alice",
      userId,
      replyId: "r1",
      replyUrl: "https://x.com/me/status/r1",
      conversationId: "root-1",
      nowMs: T0,
    });
    upsertOwnPost({ parsed: ownReply({ postId: "r1" }), userId, tenantId });

    const first = await reconcileScoutEvidence({ userId, knowledgeRoot, nowMs: T0 + 1 });
    assert.equal(first.inserted, 1);
    const take = findScoutTakeByReplyId(userId, "r1");
    assert.equal(take?.targetId, "target-1");
    assert.equal(take?.threadKind, "fact_add");
    assert.equal(take?.targetAuthor, "alice");
    assert.equal(take?.noteState, "missing");
    assert.equal(take?.actedAt, new Date(T0).toISOString());
    assert.equal(readScoutEvidenceRevision(userId).revision, 1);

    // Repeat without changes: idempotent, revision untouched.
    const again = await reconcileScoutEvidence({ userId, knowledgeRoot, nowMs: T0 + 2 });
    assert.equal(again.inserted + again.enriched + again.notesVerified, 0);
    assert.equal(readScoutEvidenceRevision(userId).revision, 1);

    await writeNote({
      knowledgeRoot,
      userId,
      threadId: "target-1",
      at: new Date(T0).toISOString(),
      reply: "reply body r1",
      replyId: "r1",
    });
    const repaired = await reconcileScoutEvidence({ userId, knowledgeRoot, nowMs: T0 + 3 });
    assert.ok(repaired.notesVerified >= 1 || repaired.enriched >= 1);
    assert.equal(findScoutTakeByReplyId(userId, "r1")?.noteState, "stored");
    assert.equal(readScoutEvidenceRevision(userId).revision, 2);
    assert.equal(listScoutEvidence({ userId }).length, 1);
    assert.equal(listScoutEvidence({ userId: "user-b" }).length, 0);
  });

  it("joins a legacy note without a reply id, but not a note for a different reply", async () => {
    const at = new Date(T0).toISOString();
    await writeNote({ knowledgeRoot, userId, threadId: "t-legacy", at, reply: "legacy reply" });
    const legacy = await verifyOwnedReplyNote({
      userId,
      threadId: "t-legacy",
      replyId: "r-legacy",
      at,
      knowledgeRoot,
    });
    assert.equal(legacy.state, "stored");
    assert.equal(legacy.reply, "legacy reply");
    await writeNote({ knowledgeRoot, userId, threadId: "t-other", at, reply: "x", replyId: "r-a" });
    const mismatch = await verifyOwnedReplyNote({
      userId,
      threadId: "t-other",
      replyId: "r-b",
      at,
      knowledgeRoot,
    });
    assert.equal(mismatch.state, "missing");
    const foreign = await verifyOwnedReplyNote({
      userId: "user-b",
      threadId: "t-legacy",
      replyId: "r-legacy",
      at,
      knowledgeRoot,
    });
    assert.equal(foreign.state, "missing");
  });

  it("confirms a trimmed-history interaction from an owned note alone", async () => {
    const at = new Date(T0).toISOString();
    await markInteracted({
      threadId: "t-note",
      author: "@bob",
      userId,
      replyId: "r-note",
      replyUrl: "https://x.com/me/status/r-note",
      nowMs: T0,
    });
    await writeNote({ knowledgeRoot, userId, threadId: "t-note", at, reply: "note text", replyId: "r-note" });
    const result = await reconcileScoutEvidence({ userId, knowledgeRoot, nowMs: T0 });
    assert.equal(result.inserted, 1);
    const take = findScoutTakeByReplyId(userId, "r-note");
    assert.equal(take?.noteState, "stored");
    assert.equal(take?.targetAuthor, "bob");
    assert.equal(take?.threadKind, null);
  });

  it("backfills confirmed own replies beyond the interaction history in bounded batches", async () => {
    for (let i = 0; i < 250; i++) {
      upsertOwnPost({
        parsed: ownReply({
          postId: `bulk-${String(i).padStart(3, "0")}`,
          inReplyToId: `target-${i}`,
          postedAt: new Date(T0 + i * 1000).toISOString(),
        }),
        userId,
        tenantId,
      });
    }
    // A self-reply never becomes a take.
    upsertOwnPost({
      parsed: ownReply({ postId: "self", inReplyToId: "mine", inReplyToUserId: X_USER }),
      userId,
      tenantId,
    });
    retainScoutTargetContext({
      userId,
      targetId: "target-7",
      threadKind: "sharp_opinion",
      author: "@seven",
      contextSource: "scout_cache",
    });

    const pass1 = await reconcileScoutEvidence({ userId, knowledgeRoot, batchSize: 100, nowMs: T0 });
    assert.equal(pass1.complete, false);
    assert.equal(pass1.inserted, 100);
    const pass2 = await reconcileScoutEvidence({ userId, knowledgeRoot, batchSize: 100, nowMs: T0 });
    assert.equal(pass2.complete, false);
    const pass3 = await reconcileScoutEvidence({ userId, knowledgeRoot, batchSize: 100, nowMs: T0 });
    assert.equal(pass3.complete, true);
    const rows = listScoutEvidence({ userId });
    assert.equal(rows.length, 250);
    assert.equal(new Set(rows.map((r) => r.replyId)).size, 250);
    assert.equal(findScoutTakeByReplyId(userId, "self"), null);
    assert.equal(findScoutTakeByReplyId(userId, "bulk-007")?.threadKind, "sharp_opinion");
    assert.equal(findScoutTakeByReplyId(userId, "bulk-007")?.targetAuthor, "seven");
    assert.equal(findScoutTakeByReplyId(userId, "bulk-008")?.threadKind, null);

    const revision = readScoutEvidenceRevision(userId).revision;
    const pass4 = await reconcileScoutEvidence({ userId, knowledgeRoot, batchSize: 100, nowMs: T0 });
    assert.equal(pass4.inserted, 0);
    assert.equal(readScoutEvidenceRevision(userId).revision, revision);
  });

  it("enriches an adapter take that lacked context without rewriting its time", async () => {
    recordScoutEvidence({
      userId,
      eventKey: takeEventKey("r-adapter"),
      action: "take",
      source: "webhook",
      targetId: "target-1",
      replyId: "r-adapter",
      actedAt: new Date(T0 - 5000).toISOString(),
      nowMs: T0 - 5000,
    });
    upsertOwnPost({ parsed: ownReply({ postId: "r-adapter" }), userId, tenantId });
    retainScoutTargetContext({
      userId,
      targetId: "target-1",
      threadKind: "timely_take",
      author: "@alice",
      contextSource: "scout_cache",
    });
    const result = await reconcileScoutEvidence({ userId, knowledgeRoot, nowMs: T0 });
    assert.equal(result.enriched, 1);
    const take = findScoutTakeByReplyId(userId, "r-adapter")!;
    assert.equal(take.threadKind, "timely_take");
    assert.equal(take.source, "webhook");
    assert.equal(take.actedAt, new Date(T0 - 5000).toISOString());
    assert.equal(listScoutEvidence({ userId }).length, 1);
  });
});
