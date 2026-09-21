import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rm, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import {
  createHashEmbedder,
  cosineSimilarity,
  parseKnowledgeNote,
  reindexMemory,
  searchMemory,
  upsertMemoryNote,
  memoryIndexStatus,
  MEMORY_INDEX_SCHEMA_VERSION,
  type Embedder,
} from "./memoryIndex.ts";
import { ownedNoteFilename } from "./ownedMemoryNotes.ts";

function note(opts: {
  type: "interaction" | "dismissal";
  userId?: string | string[];
  threadId?: string;
  sections: Record<string, string>;
  frontmatter?: boolean;
}): string {
  const fm: string[] = [];
  if (opts.frontmatter !== false) {
    fm.push("---", `type: ${opts.type}`);
    if (opts.threadId) fm.push(`threadId: "${opts.threadId}"`);
    for (const id of Array.isArray(opts.userId)
      ? opts.userId
      : opts.userId
        ? [opts.userId]
        : []) {
      fm.push(`userId: "${id}"`);
    }
    fm.push("---", "");
  }
  const body = Object.entries(opts.sections)
    .map(([k, v]) => `## ${k}\n\n${v}\n`)
    .join("\n");
  return `${fm.join("\n")}\n${body}`;
}

describe("parseKnowledgeNote", () => {
  it("extracts type, verified owner and section chunk", () => {
    const md = `---
type: interaction
threadId: "1"
userId: "user-a"
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
    assert.equal(parsed.userId, "user-a");
    assert.equal(parsed.ownerState, "owned");
    assert.match(parsed.chunk, /type: interaction/);
    assert.match(parsed.chunk, /Post: How do I ship/);
    assert.match(parsed.chunk, /Reply: Ship a tiny loop/);
    assert.match(parsed.excerpt, /Asking about shipping/);
  });

  it("parses dismissals with reason", () => {
    const md = `---
type: dismissal
userId: "user-a"
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

  it("reports unowned, blank and conflicting owners without a userId", () => {
    const unowned = parseKnowledgeNote(
      note({ type: "interaction", sections: { Post: "x" } }),
    );
    assert.equal(unowned.userId, null);
    assert.equal(unowned.ownerState, "unowned");

    const blank = parseKnowledgeNote(
      note({ type: "interaction", userId: "   ", sections: { Post: "x" } }),
    );
    assert.equal(blank.userId, null);
    assert.equal(blank.ownerState, "unowned");

    const conflict = parseKnowledgeNote(
      note({ type: "interaction", userId: ["a", "b"], sections: { Post: "x" } }),
    );
    assert.equal(conflict.userId, null);
    assert.equal(conflict.ownerState, "conflict");

    const noFrontmatter = parseKnowledgeNote("## Post\n\nno frontmatter\n");
    assert.equal(noFrontmatter.type, null);
    assert.equal(noFrontmatter.userId, null);
    assert.match(noFrontmatter.chunk, /Post: no frontmatter/);
  });

  it("includes Outcome in interaction chunk and excerpt", () => {
    const md = `---
type: interaction
userId: "user-a"
---

## Post

How do builders ship AI tools?

## Summary

Genuine shipping question.

## Reply

Ship weekly.

## Outcome

1h: 100 views · 4 likes · 1 reply · 0 reposts
24h: 420 views · 12 likes · 3 replies · 1 repost
`;
    const parsed = parseKnowledgeNote(md);
    assert.match(parsed.chunk, /Outcome: 1h: 100 views/);
    assert.match(parsed.excerpt, /Genuine shipping question/);
    assert.match(parsed.excerpt, /420 views/);
  });

  it("keeps Outcome in chunk when Reply saturates MAX_CHUNK_CHARS", () => {
    const md = `---
type: interaction
---

## Post

How do builders ship AI tools?

## Summary

Genuine shipping question.

## Reply

${"long reply ".repeat(600)}

## Outcome

24h: 420 views · 12 likes · 3 replies · 1 repost
`;
    const parsed = parseKnowledgeNote(md);
    assert.match(parsed.chunk, /Outcome: 24h: 420 views/);
    assert.match(parsed.chunk, /Post: How do builders/);
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
  const A = "user-a";
  const B = "user-b";

  const write = async (
    dir: "interactions" | "dismissals",
    name: string,
    markdown: string,
  ): Promise<string> => {
    const path = join(knowledgeRoot, dir, name);
    await writeFile(path, markdown, "utf8");
    return path;
  };

  const search = (userId: string, query: string, extra: Partial<Parameters<typeof searchMemory>[0]> = {}) =>
    searchMemory({ userId, query, k: 20, knowledgeRoot, indexDir, embedder, ...extra });

  /** Canonical owned filename (C07), so rebuild and upsert address the same row. */
  const canonical = (userId: string, threadId: string, at = "2026-07-30") =>
    ownedNoteFilename({ userId, threadId, at });

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

  it("reindexes empty vault and marks it ready under the current schema", async () => {
    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 0);
    const status = await memoryIndexStatus({ knowledgeRoot, indexDir });
    assert.equal(status.dbExists, true);
    assert.equal(status.dbIndexed, true);
    assert.equal(status.schemaVersion, MEMORY_INDEX_SCHEMA_VERSION);
  });

  it("search returns the owner's neighbors for a similar query", async () => {
    await write(
      "interactions",
      "2026-07-30-ship.md",
      note({
        type: "interaction",
        userId: A,
        threadId: "1",
        sections: {
          Post: "How do builders ship AI tools in public without burning out?",
          Summary: "Genuine question about shipping AI tools publicly.",
          Reply: "Ship weekly, keep the loop tiny.",
        },
      }),
    );
    await write(
      "dismissals",
      "2026-07-30-bait.md",
      note({
        type: "dismissal",
        userId: A,
        threadId: "2",
        sections: {
          Post: "What's your favorite AI tool? Drop it below!",
          Reason: "Generic engagement bait question.",
        },
      }),
    );

    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 2);

    const { hits } = await search(A, "builders shipping AI tools in public", { k: 2 });
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((h) => h.type === "interaction"));
    assert.ok(hits[0]!.score > 0);
    assert.ok(hits[0]!.excerpt.length > 0);
  });

  it("never returns another user's note even when it is the top match", async () => {
    const foreignPost = "Exactly the text the query will use.";
    await write(
      "interactions",
      canonical(A, "11"),
      note({
        type: "interaction",
        userId: A,
        threadId: "11",
        sections: { Post: "Something unrelated about freight and merch." },
      }),
    );
    const foreignPath = await write(
      "interactions",
      canonical(B, "12"),
      note({
        type: "interaction",
        userId: B,
        threadId: "12",
        sections: { Post: foreignPost },
      }),
    );
    assert.equal((await reindexMemory({ knowledgeRoot, indexDir, embedder })).indexed, 2);

    // Query identical to B's chunk: cosine 1.0 for B, strictly lower for A.
    const query = parseKnowledgeNote(
      note({ type: "interaction", userId: B, sections: { Post: foreignPost } }),
    ).chunk;
    const asB = await search(B, query);
    assert.equal(asB.hits.length, 1);
    assert.equal(asB.hits[0]!.path, foreignPath);
    assert.ok(asB.hits[0]!.score > 0.999);

    const asA = await search(A, query);
    assert.equal(asA.error, undefined);
    assert.equal(asA.hits.length, 1, "only A's row enters the candidate set");
    assert.notEqual(asA.hits[0]!.path, foreignPath);
    assert.ok(asA.hits[0]!.score < 0.999);

    const stranger = await search("user-c", query);
    assert.deepEqual(stranger.hits, []);
    assert.equal(stranger.error, undefined);
  });

  it("excludes unowned, blank-owner, conflicting and frontmatter-less notes", async () => {
    await write(
      "interactions",
      "2026-07-30-unowned.md",
      note({ type: "interaction", threadId: "1", sections: { Post: "legacy global note" } }),
    );
    await write(
      "interactions",
      "2026-07-30-blank.md",
      note({ type: "interaction", userId: "  ", threadId: "2", sections: { Post: "blank owner" } }),
    );
    await write(
      "dismissals",
      "2026-07-30-conflict.md",
      note({
        type: "dismissal",
        userId: [A, B],
        threadId: "3",
        sections: { Post: "two owners", Reason: "conflict" },
      }),
    );
    await write("dismissals", "2026-07-30-raw.md", "## Post\n\nno frontmatter at all\n");
    await write(
      "interactions",
      "2026-07-30-owned.md",
      note({ type: "interaction", userId: A, threadId: "4", sections: { Post: "owned" } }),
    );

    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 1);
    assert.equal(result.excluded, 4);

    for (const user of [A, B]) {
      const { hits } = await search(user, "legacy global note two owners no frontmatter");
      assert.ok(hits.every((h) => h.excerpt === "owned"));
      assert.equal(hits.length, user === A ? 1 : 0);
    }
  });

  it("fails closed without identity before touching the embedder or database", async () => {
    let embeds = 0;
    const counting: Embedder = {
      dimensions: 8,
      async embed(texts) {
        embeds++;
        return createHashEmbedder(8).embed(texts);
      },
    };
    for (const userId of ["", "   "]) {
      const result = await searchMemory({
        userId,
        query: "anything",
        knowledgeRoot,
        indexDir,
        embedder: counting,
      });
      assert.deepEqual(result.hits, []);
      assert.match(result.error ?? "", /requires a user/);
    }
    assert.equal(embeds, 0);
    assert.equal(existsSync(join(indexDir, "index.sqlite")), false);
  });

  it("drops a pre-owner (v1) index and refuses to treat it as ready", async () => {
    await mkdir(indexDir, { recursive: true });
    const dbPath = join(indexDir, "index.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE memories (
        path TEXT PRIMARY KEY, type TEXT NOT NULL, excerpt TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL, content_hash TEXT NOT NULL, embedding BLOB NOT NULL
      );
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO meta (key, value) VALUES ('indexed_at', '1');
    `);
    const vec = (await createHashEmbedder(32).embed(["global row"]))[0]!;
    legacy
      .prepare(
        "INSERT INTO memories (path, type, excerpt, mtime_ms, content_hash, embedding) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("/old/global.md", "interaction", "global row", 1, "h", Buffer.from(vec.buffer));
    legacy.close();

    const before = await memoryIndexStatus({ knowledgeRoot, indexDir });
    assert.equal(before.dbExists, true);
    assert.equal(before.dbIndexed, false, "old completed flag is not readiness");

    // Nobody can read the old global rows, and the schema is upgraded.
    const asA = await search(A, "global row");
    assert.deepEqual(asA.hits, []);
    assert.equal(asA.error, undefined);
    const db = new Database(dbPath, { readonly: true });
    const cols = (db.prepare("PRAGMA table_info(memories)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    assert.ok(cols.includes("user_id"));
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }).n, 0);
    assert.equal(db.prepare("SELECT 1 FROM meta WHERE key = 'indexed_at'").get(), undefined);
    db.close();

    await write(
      "interactions",
      "2026-07-30-owned.md",
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "owned" } }),
    );
    const rebuilt = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(rebuilt.ok, true);
    assert.equal(rebuilt.indexed, 1);
    assert.equal((await memoryIndexStatus({ knowledgeRoot, indexDir })).dbIndexed, true);
  });

  it("serves upserted owned rows from an incomplete index without marking it ready", async () => {
    const path = await write(
      "interactions",
      "2026-07-30-only.md",
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "upsert only" } }),
    );
    const up = await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder });
    assert.equal(up.ok, true);
    assert.equal((await memoryIndexStatus({ knowledgeRoot, indexDir })).dbIndexed, false);
    assert.equal((await search(A, "upsert only")).hits.length, 1);
    assert.equal((await search(B, "upsert only")).hits.length, 0);
  });

  it("does not publish or mark ready when a rebuild fails part-way", async () => {
    await write(
      "interactions",
      "2026-07-30-keep.md",
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "keep me" } }),
    );
    assert.equal((await reindexMemory({ knowledgeRoot, indexDir, embedder })).ok, true);
    for (let i = 0; i < 10; i++) {
      await write(
        "interactions",
        `2026-07-31-more-${i}.md`,
        note({ type: "interaction", userId: A, threadId: `${100 + i}`, sections: { Post: `more ${i}` } }),
      );
    }
    let calls = 0;
    const flaky: Embedder = {
      dimensions: 32,
      async embed(texts) {
        calls++;
        if (calls === 2) throw new Error("model crashed mid-rebuild");
        return embedder.embed(texts);
      },
    };
    const failed = await reindexMemory({ knowledgeRoot, indexDir, embedder: flaky });
    assert.equal(failed.ok, false);
    assert.match(failed.error ?? "", /crashed/);
    // Previous complete snapshot is intact; nothing partial leaked in.
    const { hits } = await search(A, "keep me more");
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.excerpt, "keep me");
    assert.equal((await memoryIndexStatus({ knowledgeRoot, indexDir })).dbIndexed, true);
  });

  it("upsert after Outcome patch changes excerpt and content", async () => {
    const notePath = join(knowledgeRoot, "interactions", "2026-07-30-outcome.md");
    await writeFile(
      notePath,
      note({
        type: "interaction",
        userId: A,
        threadId: "1",
        sections: { Summary: "Genuine shipping question.", Reply: "Ship weekly." },
      }),
      "utf8",
    );
    const first = await upsertMemoryNote(notePath, {
      knowledgeRoot,
      indexDir,
      embedder,
      type: "interaction",
    });
    assert.equal(first.ok, true);

    await writeFile(
      notePath,
      note({
        type: "interaction",
        userId: A,
        threadId: "1",
        sections: {
          Summary: "Genuine shipping question.",
          Reply: "Ship weekly.",
          Outcome: "24h: 420 views · 12 likes · 3 replies · 1 repost",
        },
      }),
      "utf8",
    );
    await utimes(notePath, new Date(), new Date(Date.now() + 2000));
    const second = await upsertMemoryNote(notePath, {
      knowledgeRoot,
      indexDir,
      embedder,
      type: "interaction",
    });
    assert.equal(second.ok, true);

    const { hits } = await search(A, "Genuine shipping question", { types: ["interaction"] });
    assert.ok(hits.some((h) => /420 views/.test(h.excerpt)));
  });

  it("owner-only edit with an unchanged chunk moves the row to the new owner", async () => {
    const body = { Post: "Same words, different owner.", Reason: "reason" };
    const path = await write(
      "dismissals",
      "2026-07-30-move.md",
      note({ type: "dismissal", userId: A, threadId: "1", sections: body }),
    );
    assert.equal((await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder })).ok, true);
    assert.equal((await search(A, "Same words")).hits.length, 1);

    await writeFile(path, note({ type: "dismissal", userId: B, threadId: "1", sections: body }), "utf8");
    await utimes(path, new Date(), new Date(Date.now() + 2000));
    assert.equal((await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder })).ok, true);
    assert.equal((await search(A, "Same words")).hits.length, 0);
    assert.equal((await search(B, "Same words")).hits.length, 1);

    // Losing the owner removes the row entirely rather than leaving a stale one.
    await writeFile(path, note({ type: "dismissal", threadId: "1", sections: body }), "utf8");
    await utimes(path, new Date(), new Date(Date.now() + 4000));
    const gone = await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder });
    assert.equal(gone.ok, false);
    assert.match(gone.error ?? "", /no verified owner/);
    assert.equal((await search(A, "Same words")).hits.length, 0);
    assert.equal((await search(B, "Same words")).hits.length, 0);
  });

  it("indexes a migrated legacy note once, at its canonical path", async () => {
    const legacy = await write(
      "interactions",
      "2026-07-30-123.md",
      note({
        type: "interaction",
        userId: A,
        threadId: "123",
        sections: { Post: "legacy but owned" },
      }),
    );
    const canonicalName = ownedNoteFilename({ userId: A, threadId: "123", at: "2026-07-30" });
    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 1);
    assert.ok(existsSync(join(knowledgeRoot, "interactions", canonicalName)));
    assert.ok(existsSync(legacy), "original never deleted");
    const { hits } = await search(A, "legacy but owned");
    assert.equal(hits.length, 1);
    assert.ok(hits[0]!.path.endsWith(canonicalName));
  });

  it("upsert and rebuild produce the same owned row", async () => {
    const path = await write(
      "interactions",
      canonical(A, "1"),
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "parity", Summary: "same row" } }),
    );
    assert.equal((await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder })).ok, true);
    const viaUpsert = (await search(A, "parity")).hits;
    assert.equal((await reindexMemory({ knowledgeRoot, indexDir, embedder })).indexed, 1);
    const viaRebuild = (await search(A, "parity")).hits;
    assert.deepEqual(viaRebuild, viaUpsert);
    assert.equal((await search(B, "parity")).hits.length, 0);
  });

  it("upsert adds a note without full reindex", async () => {
    await reindexMemory({ knowledgeRoot, indexDir, embedder });
    const notePath = await write(
      "dismissals",
      "2026-07-31-new.md",
      note({
        type: "dismissal",
        userId: A,
        threadId: "9",
        sections: {
          Post: "Comment AI and I'll DM you the prompt pack",
          Reason: "Reply-gated promo bait.",
        },
      }),
    );
    const up = await upsertMemoryNote(notePath, {
      knowledgeRoot,
      indexDir,
      embedder,
      type: "dismissal",
    });
    assert.equal(up.ok, true);

    const { hits } = await search(A, "comment AI and I'll DM the prompt pack", {
      types: ["dismissal"],
    });
    assert.ok(hits.some((h) => h.path === notePath || h.path.endsWith("2026-07-31-new.md")));
  });

  it("a completed rebuild keeps rows upserted while it ran and their newer content", async () => {
    const existing = await write(
      "interactions",
      canonical(A, "1"),
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "Race condition note." } }),
    );
    let raced = false;
    const racingEmbedder: Embedder = {
      dimensions: embedder.dimensions,
      async embed(texts) {
        if (!raced) {
          raced = true;
          // Another process edits + upserts the note the rebuild already read,
          // and upserts a note the rebuild never enumerated.
          await writeFile(
            existing,
            note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "Race condition note, edited." } }),
            "utf8",
          );
          await utimes(existing, new Date(), new Date(Date.now() + 5000));
          const up1 = await upsertMemoryNote(existing, { knowledgeRoot, indexDir, embedder });
          assert.equal(up1.ok, true);
          const fresh = await write(
            "dismissals",
            canonical(A, "2"),
            note({ type: "dismissal", userId: A, threadId: "2", sections: { Post: "fresh during rebuild", Reason: "r" } }),
          );
          const up2 = await upsertMemoryNote(fresh, { knowledgeRoot, indexDir, embedder });
          assert.equal(up2.ok, true);
        }
        return embedder.embed(texts);
      },
    };
    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder: racingEmbedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 1);

    const all = await search(A, "race condition fresh during rebuild");
    assert.equal(all.hits.length, 2, "concurrent upsert not erased by the rebuild");
    const edited = all.hits.find((h) => h.path === existing);
    assert.ok(edited);
    assert.match(edited.excerpt, /edited/);
    assert.ok(all.hits.some((h) => h.path.endsWith(canonical(A, "2"))));
    assert.equal((await memoryIndexStatus({ knowledgeRoot, indexDir })).dbIndexed, true);
  });

  it("indexes one row per migrated legacy note and keeps the original file", async () => {
    const legacyPath = join(knowledgeRoot, "interactions", "2026-07-30-2081.md");
    const legacyNote = `---
type: interaction
threadId: "2081"
userId: "user-a"
interactedAt: "2026-07-30T12:00:00.000Z"
---

## Summary

Owned legacy shipping question.

## Reply

Ship weekly.
`;
    await writeFile(legacyPath, legacyNote, "utf8");
    await writeFile(
      join(knowledgeRoot, "interactions", "2026-07-30-2082.md"),
      `---\ntype: interaction\nthreadId: "2082"\n---\n\n## Summary\n\nUnowned legacy note stays indexed as itself.\n`,
      "utf8",
    );
    const result = await reindexMemory({ knowledgeRoot, indexDir, embedder });
    assert.equal(result.ok, true);
    assert.equal(result.indexed, 1);
    assert.equal(result.excluded, 1);
    const names = (await readdir(join(knowledgeRoot, "interactions"))).filter((n) =>
      n.endsWith(".md"),
    );
    assert.equal(names.length, 3);
    assert.ok(names.includes("2026-07-30-2081.md"));
    assert.equal(await readFile(legacyPath, "utf8"), legacyNote);
    const { hits } = await search(A, "Owned legacy shipping question", { k: 5 });
    const legacyHits = hits.filter((h) => /2081/.test(h.path));
    assert.equal(legacyHits.length, 1);
    assert.match(legacyHits[0]!.path, /-u[0-9a-f]{64}-2081\.md$/);
  });

  it("a slow upsert cannot overwrite a fresher row a rebuild published meanwhile", async () => {
    const path = await write(
      "interactions",
      canonical(A, "1"),
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "version one" } }),
    );
    await utimes(path, new Date(), new Date(Date.now() - 10_000));
    let interrupted = false;
    const slowEmbedder: Embedder = {
      dimensions: embedder.dimensions,
      async embed(texts) {
        if (!interrupted) {
          interrupted = true;
          await writeFile(
            path,
            note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "version two" } }),
            "utf8",
          );
          await utimes(path, new Date(), new Date());
          const rebuilt = await reindexMemory({ knowledgeRoot, indexDir, embedder });
          assert.equal(rebuilt.ok, true);
        }
        return embedder.embed(texts);
      },
    };
    const up = await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder: slowEmbedder });
    assert.equal(up.ok, true);
    const { hits } = await search(A, "version");
    assert.equal(hits.length, 1);
    assert.match(hits[0]!.excerpt, /version two/);
  });

  it("a rebuild cannot resurrect a row removed by a newer owner-loss upsert", async () => {
    const path = await write(
      "interactions",
      canonical(A, "owner-loss"),
      note({ type: "interaction", userId: A, threadId: "owner-loss", sections: { Post: "must disappear" } }),
    );
    assert.equal((await reindexMemory({ knowledgeRoot, indexDir, embedder })).indexed, 1);

    let raced = false;
    const racingEmbedder: Embedder = {
      dimensions: embedder.dimensions,
      async embed(texts) {
        if (!raced) {
          raced = true;
          await writeFile(
            path,
            note({ type: "interaction", threadId: "owner-loss", sections: { Post: "owner removed" } }),
            "utf8",
          );
          await utimes(path, new Date(), new Date(Date.now() + 5000));
          const up = await upsertMemoryNote(path, { knowledgeRoot, indexDir, embedder });
          assert.equal(up.ok, false);
        }
        return embedder.embed(texts);
      },
    };
    const rebuilt = await reindexMemory({ knowledgeRoot, indexDir, embedder: racingEmbedder });
    assert.equal(rebuilt.ok, true);
    assert.equal((await search(A, "must disappear")).hits.length, 0);
  });

  it("search surfaces embedder failure as unavailable, never old rows", async () => {
    await write(
      "interactions",
      "2026-07-30-x.md",
      note({ type: "interaction", userId: A, threadId: "1", sections: { Post: "indexed earlier" } }),
    );
    assert.equal((await reindexMemory({ knowledgeRoot, indexDir, embedder })).indexed, 1);
    const bad: Embedder = {
      dimensions: 8,
      async embed() {
        throw new Error("model missing");
      },
    };
    const result = await searchMemory({
      userId: A,
      query: "indexed earlier",
      knowledgeRoot,
      indexDir,
      embedder: bad,
    });
    assert.deepEqual(result.hits, []);
    assert.ok(result.error);

    const rebuild = await reindexMemory({ knowledgeRoot, indexDir, embedder: bad });
    assert.equal(rebuild.ok, false);
    assert.equal((await search(A, "indexed earlier")).hits.length, 1, "prior snapshot intact");
  });
});
