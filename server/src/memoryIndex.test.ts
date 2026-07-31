import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHashEmbedder,
  cosineSimilarity,
  parseKnowledgeNote,
  reindexMemory,
  searchMemory,
  upsertMemoryNote,
  memoryIndexStatus,
} from "./memoryIndex.ts";

describe("parseKnowledgeNote", () => {
  it("extracts type and section chunk", () => {
    const md = `---
type: interaction
threadId: "1"
---

## Post

How do I ship AI tools in public?

## Summary

Asking about shipping AI tools

## Reply

Ship a tiny loop first.
`;
    const parsed = parseKnowledgeNote(md);
    assert.equal(parsed.type, "interaction");
    assert.match(parsed.chunk, /type: interaction/);
    assert.match(parsed.chunk, /Post: How do I ship/);
    assert.match(parsed.chunk, /Reply: Ship a tiny loop/);
    assert.match(parsed.excerpt, /Asking about shipping/);
  });

  it("parses dismissals with reason", () => {
    const md = `---
type: dismissal
---

## Post

Drop your favorite AI tool below!

## Reason

Engagement bait listicle.
`;
    const parsed = parseKnowledgeNote(md);
    assert.equal(parsed.type, "dismissal");
    assert.match(parsed.chunk, /Reason: Engagement bait/);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const a = Float32Array.from([1, 0, 0]);
    assert.equal(cosineSimilarity(a, a), 1);
  });
});

describe("memoryIndex with injectable embedder", () => {
  let knowledgeRoot: string;
  let indexDir: string;
  const embedder = createHashEmbedder(32);

  beforeEach(async () => {
    const base = join(
      tmpdir(),
      `mem-idx-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    knowledgeRoot = join(base, "knowledge");
    indexDir = join(base, "index");
    await mkdir(join(knowledgeRoot, "interactions"), { recursive: true });
    await mkdir(join(knowledgeRoot, "dismissals"), { recursive: true });
  });

  afterEach(async () => {
    await rm(join(knowledgeRoot, ".."), { recursive: true, force: true });
  });

  it("reindexes empty vault without crashing", async () => {
    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 0);
    const status = memoryIndexStatus({ knowledgeRoot, indexDir });
    assert.equal(status.dbExists, true);
  });

  it("search returns neighbors for similar query", async () => {
    await writeFile(
      join(knowledgeRoot, "interactions", "2026-07-30-ship.md"),
      `---
type: interaction
---

## Post

How do builders ship AI tools in public without burning out?

## Summary

Genuine question about shipping AI tools publicly.

## Reply

Ship weekly, keep the loop tiny.
`,
      "utf8",
    );
    await writeFile(
      join(knowledgeRoot, "dismissals", "2026-07-30-bait.md"),
      `---
type: dismissal
---

## Post

What's your favorite AI tool? Drop it below!

## Reason

Generic engagement bait question.
`,
      "utf8",
    );

    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 2);

    const hits = await searchMemory({
      query: "builders shipping AI tools in public",
      k: 2,
      knowledgeRoot,
      indexDir,
      embedder,
    });
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((h) => h.type === "interaction"));
    assert.ok(hits[0]!.score > 0);
    assert.ok(hits[0]!.excerpt.length > 0);
  });

  it("upsert adds a note without full reindex", async () => {
    await reindexMemory({ knowledgeRoot, indexDir, embedder });
    const notePath = join(knowledgeRoot, "dismissals", "2026-07-31-new.md");
    await writeFile(
      notePath,
      `---
type: dismissal
---

## Post

Comment AI and I'll DM you the prompt pack

## Reason

Reply-gated promo bait.
`,
      "utf8",
    );

    const up = await upsertMemoryNote(notePath, {
      knowledgeRoot,
      indexDir,
      embedder,
      type: "dismissal",
    });
    assert.equal(up.ok, true);

    const hits = await searchMemory({
      query: "comment AI and I'll DM the prompt pack",
      k: 3,
      types: ["dismissal"],
      knowledgeRoot,
      indexDir,
      embedder,
    });
    assert.ok(hits.some((h) => h.path === notePath || h.path.endsWith("2026-07-31-new.md")));
  });

  it("reindex survives a racing upsert on the same path", async () => {
    const notePath = join(knowledgeRoot, "interactions", "2026-07-30-race.md");
    await writeFile(
      notePath,
      `---
type: interaction
---

## Post

Race condition note.
`,
      "utf8",
    );
    const indexDirCopy = indexDir;
    let raced = false;
    const racingEmbedder: typeof embedder = {
      dimensions: embedder.dimensions,
      async embed(texts: string[]): Promise<Float32Array[]> {
        if (!raced) {
          raced = true;
          const up = await upsertMemoryNote(notePath, {
            knowledgeRoot,
            indexDir: indexDirCopy,
            embedder,
            type: "interaction",
          });
          assert.equal(up.ok, true);
        }
        return embedder.embed(texts);
      },
    };
    const result = await reindexMemory({
      knowledgeRoot,
      indexDir,
      embedder: racingEmbedder,
    });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 1);
  });

  it("search soft-fails to empty when embedder throws", async () => {
    const bad: typeof embedder = {
      dimensions: 8,
      async embed() {
        throw new Error("model missing");
      },
    };
    const hits = await searchMemory({
      query: "anything",
      knowledgeRoot,
      indexDir,
      embedder: bad,
    });
    assert.deepEqual(hits, []);
  });
});
