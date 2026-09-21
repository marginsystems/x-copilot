import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultMigrationsDir,
  getPlatformDb,
  resetPlatformDbForTests,
} from "../db.ts";
import { markInteracted } from "../desk/interactionStore.ts";
import { writeInteractionMemory } from "../memory/knowledgeMemory.ts";
import { seedUser } from "../platform/platformDb.testHelpers.ts";
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

  beforeEach(async () => {
    resetPlatformDbForTests();
    dbDir = mkdtempSync(join(tmpdir(), "x-voice-local-"));
    process.env.PLATFORM_DB_PATH = join(dbDir, "platform.sqlite");
    process.env.PLATFORM_MIGRATIONS_DIR = defaultMigrationsDir();
    getPlatformDb();
    root = await mkdtemp(join(tmpdir(), "x-voice-local-knowledge-"));
  });

  afterEach(() => {
    resetPlatformDbForTests();
    delete process.env.PLATFORM_DB_PATH;
    delete process.env.PLATFORM_MIGRATIONS_DIR;
    rmSync(dbDir, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("folds only the calling user's memory into their voice corpus", async () => {
    seedUser("user-a");
    seedUser("user-b");
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
    });

    const addedB = await foldLocalVoiceSources("user-b", { knowledgeRoot: root });
    assert.equal(addedB, 0);
    assert.equal(listVoiceReplies("user-b").length, 0);

    const addedA = await foldLocalVoiceSources("user-a", { knowledgeRoot: root });
    assert.equal(addedA, 1);
    const rows = listVoiceReplies("user-a", 10);
    assert.equal(rows[0]?.text, "A's own reply");
    assert.equal(rows[0]?.id, "999");
  });

  it("folds unowned notes when exactly one platform user exists", async () => {
    getPlatformDb()
      .prepare(
        `INSERT INTO users (id, email, created_at, last_login_at)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        "user-a",
        "a@example.com",
        new Date().toISOString(),
        new Date().toISOString(),
      );
    await writeLegacyNote(root, "2026-07-27-333.md", {
      threadId: "333",
      reply: "pre-PR reply with no userId",
    });
    const added = await foldLocalVoiceSources("user-a", {
      knowledgeRoot: root,
    });
    assert.equal(added, 1);
    const rows = listVoiceReplies("user-a", 10);
    assert.equal(rows[0]?.text, "pre-PR reply with no userId");
    // The unowned original is untouched and never copied to an owned path.
    assert.deepEqual(readdirSync(join(root, "interactions")), ["2026-07-27-333.md"]);
  });

  it("keeps unowned notes out of every corpus on a multi-user install", async () => {
    seedUser("user-a");
    seedUser("user-b");
    await writeLegacyNote(root, "2026-07-27-333.md", {
      threadId: "333",
      reply: "pre-PR reply with no userId",
    });
    assert.equal(await foldLocalVoiceSources("user-a", { knowledgeRoot: root }), 0);
    assert.equal(await foldLocalVoiceSources("user-b", { knowledgeRoot: root }), 0);
    assert.equal(listVoiceReplies("user-a").length, 0);
    assert.equal(listVoiceReplies("user-b").length, 0);
  });

  it("folds a migrated owned legacy note exactly once", async () => {
    seedUser("user-a");
    seedUser("user-b");
    await writeLegacyNote(root, "2026-07-27-444.md", {
      threadId: "444",
      userId: "user-a",
      reply: "owned legacy reply",
    });
    await markInteracted({
      threadId: "444",
      author: "@A",
      userId: "user-a",
      replyId: "4440",
    });
    assert.equal(await foldLocalVoiceSources("user-a", { knowledgeRoot: root }), 1);
    // Scanning copied the note to its owned path; the original remains.
    const names = readdirSync(join(root, "interactions")).filter((n) => n.endsWith(".md"));
    assert.equal(names.length, 2);
    assert.ok(names.includes("2026-07-27-444.md"));
    assert.equal(await foldLocalVoiceSources("user-a", { knowledgeRoot: root }), 0);
    const rows = listVoiceReplies("user-a", 10);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.text, "owned legacy reply");
    assert.equal(await foldLocalVoiceSources("user-b", { knowledgeRoot: root }), 0);
  });
});

async function writeLegacyNote(
  root: string,
  name: string,
  opts: { threadId: string; userId?: string; reply: string },
): Promise<void> {
  const dir = join(root, "interactions");
  await mkdir(dir, { recursive: true });
  const owner = opts.userId ? `userId: "${opts.userId}"\n` : "";
  await writeFile(
    join(dir, name),
    `---\ntype: interaction\nthreadId: "${opts.threadId}"\n${owner}interactedAt: "2026-07-27T01:02:03.000Z"\n---\n\n## Reply\n\n${opts.reply}\n`,
    "utf8",
  );
}
