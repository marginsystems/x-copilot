import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "./db.ts";
import { markInteracted } from "./interactionStore.ts";
import { writeInteractionMemory } from "./knowledgeMemory.ts";
import { foldLocalVoiceSources, memoryRepliesToVoiceInputs } from "./voiceLocal.ts";
import { listVoiceReplies } from "./voiceStore.ts";

describe("memoryRepliesToVoiceInputs", () => {
  it("prefers the marked reply id and conversation root", () => {
    const rows = memoryRepliesToVoiceInputs(
      [
        {
          threadId: "111",
          text: "my reply",
          postedAt: "2026-08-16T12:00:00.000Z",
        },
      ],
      [
        {
          threadId: "111",
          replyId: "999",
          conversationId: "100",
          inReplyToId: "111",
          at: "2026-08-16T12:01:00.000Z",
        },
      ],
    );
    assert.deepEqual(rows, [
      {
        id: "999",
        text: "my reply",
        conversationId: "100",
        inReplyToId: "111",
        postedAt: "2026-08-16T12:00:00.000Z",
        source: "memory",
      },
    ]);
  });

  it("falls back to mem:threadId when the mark has no reply id", () => {
    const rows = memoryRepliesToVoiceInputs(
      [{ threadId: "222", text: "solo", postedAt: null }],
      [],
    );
    assert.equal(rows[0]?.id, "mem:222");
    assert.equal(rows[0]?.conversationId, "222");
  });
});

describe("foldLocalVoiceSources", () => {
  let dbDir: string;
  let root: string;
  let storePath: string;

  beforeEach(async () => {
    resetPlatformDbForTests();
    dbDir = mkdtempSync(join(tmpdir(), "x-voice-local-"));
    process.env.PLATFORM_DB_PATH = join(dbDir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    root = await mkdtemp(join(tmpdir(), "x-voice-local-knowledge-"));
    storePath = join(dbDir, "interactions.json");
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("folds only the calling user's memory into their voice corpus", async () => {
    await writeInteractionMemory({
      threadId: "111",
      author: "@A",
      reply: "A's own reply",
      userId: "user-a",
      knowledgeRoot: root,
      interactedAt: "2026-07-27T01:02:03.000Z",
    });
    await markInteracted({
      threadId: "111",
      author: "@A",
      userId: "user-a",
      replyId: "999",
      storePath,
    });

    const addedB = await foldLocalVoiceSources("user-b", { knowledgeRoot: root, storePath });
    assert.equal(addedB, 0);
    assert.equal(listVoiceReplies("user-b").length, 0);

    const addedA = await foldLocalVoiceSources("user-a", { knowledgeRoot: root, storePath });
    assert.equal(addedA, 1);
    const rows = listVoiceReplies("user-a", 10);
    assert.equal(rows[0]?.text, "A's own reply");
    assert.equal(rows[0]?.id, "999");
  });
});
