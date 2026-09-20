import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  attachInteractionMemoryReceipts,
  lookupInteractionMemoryReceipts,
  resetInteractionMemoryReceiptForTests,
} from "./interactionMemoryReceipt.ts";
import { writeInteractionMemory } from "./knowledgeMemory.ts";

const interactedAt = "2026-07-27T12:00:00.000Z";

describe("lookupInteractionMemoryReceipts", () => {
  let root: string;

  beforeEach(async () => {
    resetInteractionMemoryReceiptForTests();
    root = await mkdtemp(join(tmpdir(), "x-copilot-c05-receipt-"));
  });

  afterEach(async () => {
    resetInteractionMemoryReceiptForTests();
    await rm(root, { recursive: true, force: true });
  });

  it("returns saved when the current user's matching note exists", async () => {
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "Thanks — here's a concrete tip.",
      userId: "user-1",
      interactedAt,
      knowledgeRoot: root,
    });
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["saved"]);
  });

  it("returns no_reply_text when storage exists but the note does not", async () => {
    await mkdir(join(root, "interactions"), { recursive: true });
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["no_reply_text"]);
  });

  it("returns unavailable for a matching note owned by someone else", async () => {
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "Someone else's saved reply.",
      userId: "user-other",
      interactedAt,
      knowledgeRoot: root,
    });
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["unavailable"]);
  });

  it("returns unavailable for an unowned matching note", async () => {
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "Legacy note with no owner.",
      interactedAt,
      knowledgeRoot: root,
    });
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["unavailable"]);
  });

  it("does not use an older note for a later interaction", async () => {
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "My saved reply.",
      userId: "user-1",
      interactedAt: "2026-08-10T12:00:00.000Z",
      knowledgeRoot: root,
    });
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "Someone else's newer reply.",
      userId: "user-other",
      interactedAt: "2026-08-12T12:00:00.000Z",
      knowledgeRoot: root,
    });
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: "2026-08-11T12:00:00.000Z" }],
    });
    assert.deepEqual(states, ["no_reply_text"]);
  });

  it("reports unavailable when the expected-date note belongs to another user", async () => {
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "My saved reply.",
      userId: "user-1",
      interactedAt: "2026-08-10T12:00:00.000Z",
      knowledgeRoot: root,
    });
    await writeInteractionMemory({
      threadId: "2081",
      author: "@Builder",
      reply: "Someone else's reply at the expected date.",
      userId: "user-other",
      interactedAt: "2026-08-11T12:00:00.000Z",
      knowledgeRoot: root,
    });
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: "2026-08-11T12:00:00.000Z" }],
    });
    assert.deepEqual(states, ["unavailable"]);
  });

  it("returns unavailable when interaction storage is missing", async () => {
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: join(root, "missing-vault"),
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["unavailable"]);
  });

  it("does not treat MiniLM or index files as saved", async () => {
    await mkdir(join(root, "interactions"), { recursive: true });
    await mkdir(join(root, "index"), { recursive: true });
    await writeFile(join(root, "index", "ready"), "minilm-ok", "utf8");
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["no_reply_text"]);
  });

  it("looks up only the returned interaction set", async () => {
    await writeInteractionMemory({
      threadId: "2081",
      author: "@A",
      reply: "Owned reply",
      userId: "user-1",
      interactedAt,
      knowledgeRoot: root,
    });
    await writeInteractionMemory({
      threadId: "2099",
      author: "@B",
      reply: "Other thread must not be scanned as a count.",
      userId: "user-1",
      interactedAt,
      knowledgeRoot: root,
    });
    const attached = await attachInteractionMemoryReceipts(
      [{ threadId: "2081", at: interactedAt, extra: true }],
      { userId: "user-1", knowledgeRoot: root },
    );
    assert.equal(attached.length, 1);
    assert.deepEqual(attached[0]?.memory, { state: "saved" });
    assert.equal(attached[0]?.extra, true);
    assert.equal("memoryPath" in attached[0]!.memory, false);
  });

  it("never throws when a note file is unreadable", async () => {
    await mkdir(join(root, "interactions"), { recursive: true });
    await writeFile(
      join(root, "interactions", "2026-07-27-2081.md"),
      "not a note",
      "utf8",
    );
    const states = await lookupInteractionMemoryReceipts({
      userId: "user-1",
      knowledgeRoot: root,
      interactions: [{ threadId: "2081", at: interactedAt }],
    });
    assert.deepEqual(states, ["unavailable"]);
  });
});
