import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHashEmbedder,
  memoryIndexStatus,
  searchMemory,
  type Embedder,
} from "./memoryIndex.ts";
import {
  ensureMemoryIndex,
  parseMemoryTypes,
  runMemoryReindex,
  scheduleMemoryUpsert,
} from "./memoryReindex.ts";
import { ownedNoteFilename } from "./ownedMemoryNotes.ts";

const A = "user-a";

function ownedNote(threadId: string, post: string): string {
  return `---\ntype: interaction\nthreadId: "${threadId}"\nuserId: "${A}"\n---\n\n## Post\n\n${post}\n`;
}

await describe("memoryReindex", async () => {
  let knowledgeRoot: string;
  let indexDir: string;
  const embedder = createHashEmbedder(16);

  beforeEach(async () => {
    const base = join(
      tmpdir(),
      `mem-reindex-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    knowledgeRoot = join(base, "knowledge");
    indexDir = join(base, "index");
    await mkdir(join(knowledgeRoot, "interactions"), { recursive: true });
    await mkdir(join(knowledgeRoot, "dismissals"), { recursive: true });
  });

  afterEach(async () => {
    await rm(join(knowledgeRoot, ".."), { recursive: true, force: true });
  });

  await it("ensureMemoryIndex rebuilds once when no complete owned rebuild exists", async () => {
    await writeFile(
      join(knowledgeRoot, "interactions", ownedNoteFilename({ userId: A, threadId: "1", at: "2026-07-30" })),
      ownedNote("1", "first"),
      "utf8",
    );
    let embeds = 0;
    const counting: Embedder = {
      dimensions: 16,
      async embed(texts) {
        embeds++;
        return embedder.embed(texts);
      },
    };
    assert.equal((await memoryIndexStatus({ knowledgeRoot, indexDir })).dbIndexed, false);
    await ensureMemoryIndex({ knowledgeRoot, indexDir, embedder: counting });
    assert.equal(embeds, 1);
    assert.equal((await memoryIndexStatus({ knowledgeRoot, indexDir })).dbIndexed, true);

    // Ready under the current schema: no second rebuild.
    await ensureMemoryIndex({ knowledgeRoot, indexDir, embedder: counting });
    assert.equal(embeds, 1);
  });

  await it("scheduleMemoryUpsert waits for the in-flight rebuild so its row survives", async () => {
    const existing = join(
      knowledgeRoot,
      "interactions",
      ownedNoteFilename({ userId: A, threadId: "1", at: "2026-07-30" }),
    );
    await writeFile(existing, ownedNote("1", "already there"), "utf8");
    const fresh = join(
      knowledgeRoot,
      "interactions",
      ownedNoteFilename({ userId: A, threadId: "2", at: "2026-07-30" }),
    );

    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: Embedder = {
      dimensions: 16,
      async embed(texts) {
        await gate;
        return embedder.embed(texts);
      },
    };

    const rebuild = runMemoryReindex({ knowledgeRoot, indexDir, embedder: slow });
    await writeFile(fresh, ownedNote("2", "written mid-rebuild"), "utf8");
    const upsert = scheduleMemoryUpsert(fresh, "interaction", {
      knowledgeRoot,
      indexDir,
      embedder,
    });
    release();
    const result = await rebuild;
    await upsert;
    assert.equal(result.ok, true);

    const { hits } = await searchMemory({
      userId: A,
      query: "already there written mid-rebuild",
      k: 10,
      knowledgeRoot,
      indexDir,
      embedder,
    });
    assert.equal(hits.length, 2);
    assert.ok(hits.some((h) => h.excerpt === "written mid-rebuild"));
    assert.ok(hits.some((h) => h.excerpt === "already there"));
  });

  await it("runMemoryReindex shares one in-flight rebuild", async () => {
    let embeds = 0;
    await writeFile(
      join(knowledgeRoot, "interactions", ownedNoteFilename({ userId: A, threadId: "1", at: "2026-07-30" })),
      ownedNote("1", "shared"),
      "utf8",
    );
    const counting: Embedder = {
      dimensions: 16,
      async embed(texts) {
        embeds++;
        await new Promise((r) => setTimeout(r, 5));
        return embedder.embed(texts);
      },
    };
    const [x, y] = await Promise.all([
      runMemoryReindex({ knowledgeRoot, indexDir, embedder: counting }),
      runMemoryReindex({ knowledgeRoot, indexDir, embedder: counting }),
    ]);
    assert.equal(x, y);
    assert.equal(embeds, 1);
  });

  await it("parseMemoryTypes keeps only known types", () => {
    assert.deepEqual(parseMemoryTypes(["dismissal", "bogus", "dismissal"]), ["dismissal"]);
    assert.equal(parseMemoryTypes(["bogus"]), undefined);
    assert.equal(parseMemoryTypes("interaction"), undefined);
  });
});
