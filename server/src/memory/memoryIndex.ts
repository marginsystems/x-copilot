/**
 * Local embedding index over knowledge/{interactions,dismissals}.
 * Advisory retrieval for Scout triage — soft-fails when model/index unavailable.
 *
 * Every row carries its verified owner (frontmatter `userId`, C07 metadata
 * rules) and every search is filtered by `user_id` in SQL before cosine
 * ranking. Unowned or conflicting notes are never indexed, so no caller can
 * fall back to a global corpus.
 */
/// <reference path="../xenova-transformers.d.ts" />
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { withFileLock } from "../platform/fileLock.js";
import { defaultKnowledgeRoot, projectRoot } from "./knowledgeMemory.js";
import { enumerateMemoryNotes } from "./memoryLegacyMigration.js";
import {
  parseOwnedNoteMetadata,
  type OwnedNoteMetadata,
  type OwnerState,
} from "./ownedMemoryNotes.js";

export type MemoryType = "interaction" | "dismissal";

export type MemoryHit = {
  path: string;
  type: MemoryType;
  score: number;
  excerpt: string;
};

export type Embedder = {
  dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
};

export type MemoryIndexPaths = {
  knowledgeRoot: string;
  indexDir: string;
  dbPath: string;
};

export type SearchMemoryOpts = {
  /** Authenticated owner whose notes may be returned. Blank fails closed. */
  userId: string;
  query: string;
  k?: number;
  types?: MemoryType[];
  /** Override roots / embedder (tests). */
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
};

export type SearchMemoryResult = {
  hits: MemoryHit[];
  /** Set when the model or index DB is unavailable, vs. a genuine no-match. */
  error?: string;
};

export type ReindexResult = {
  ok: boolean;
  indexed: number;
  skipped: number;
  /** Notes left out because their owner could not be verified. */
  excluded?: number;
  error?: string;
};

export type UpsertResult = {
  ok: boolean;
  path?: string;
  error?: string;
};

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMS = 384;
const MAX_CHUNK_CHARS = 2000;
const MAX_EXCERPT_CHARS = 400;
const DB_FILENAME = "index.sqlite";
/**
 * Derived-schema version. Bumped when a row's meaning changes (v2 added the
 * verified owner). Distinct from the pre-C08 `indexed_at` flag so an old
 * global index is never mistaken for a ready user-scoped one.
 */
export const MEMORY_INDEX_SCHEMA_VERSION = "2";
const META_SCHEMA_KEY = "schema_version";
const META_READY_KEY = "indexed_schema";
const LEGACY_READY_KEY = "indexed_at";

let cachedEmbedder: Embedder | null = null;
let embedderLoadError: string | null = null;
let embedderPromise: Promise<Embedder> | null = null;

export function defaultIndexDir(): string {
  return resolve(projectRoot, "data", "memory-index");
}

export function resolveIndexPaths(opts?: {
  knowledgeRoot?: string;
  indexDir?: string;
}): MemoryIndexPaths {
  const knowledgeRoot = opts?.knowledgeRoot ?? defaultKnowledgeRoot();
  const indexDir = opts?.indexDir ?? defaultIndexDir();
  return {
    knowledgeRoot,
    indexDir,
    dbPath: join(indexDir, DB_FILENAME),
  };
}

/** Trimmed nonblank owner id, or null. Never derived from anything but the argument. */
export function normalizeMemoryOwner(userId: unknown): string | null {
  const id = typeof userId === "string" ? userId.trim() : "";
  return id || null;
}

export type ParsedKnowledgeNote = {
  type: MemoryType | null;
  chunk: string;
  excerpt: string;
  /** Verified owner; null unless ownerState is "owned". */
  userId: string | null;
  ownerState: OwnerState;
};

/** Extract ## Section bodies, frontmatter type and verified owner from a knowledge note. */
export function parseKnowledgeNote(markdown: string): ParsedKnowledgeNote {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  const meta: OwnedNoteMetadata | null = parseOwnedNoteMetadata(trimmed);
  const type: MemoryType | null = meta?.type ?? null;
  const body = meta ? meta.body.replace(/^\s*\n/, "") : trimmed;

  const sections = extractSections(body);
  const parts: string[] = [];
  if (type) parts.push(`type: ${type}`);
  for (const key of [
    "Outcome",
    "Post",
    "Summary",
    "Reply",
    "Reason",
    "OP",
  ] as const) {
    const text = sections[key];
    if (text) parts.push(`${key}: ${text}`);
  }
  const chunk = truncate(parts.join("\n\n"), MAX_CHUNK_CHARS);
  // Interactions: keep semantic Summary/Post plus Outcome so triage sees performance.
  // Dismissals: unchanged preference order (no Outcome).
  let excerptSource: string;
  if (type === "interaction") {
    const semantic = sections.Summary || sections.Post || sections.Reply || "";
    const outcome = sections.Outcome || "";
    excerptSource = [semantic, outcome].filter(Boolean).join(" · ") || chunk;
  } else {
    excerptSource =
      sections.Summary ||
      sections.Post ||
      sections.Reply ||
      sections.Reason ||
      chunk;
  }
  const excerpt = truncate(excerptSource.replace(/\s+/g, " ").trim(), MAX_EXCERPT_CHARS);
  const ownerState: OwnerState = meta?.ownerState ?? "unowned";
  const userId = ownerState === "owned" ? normalizeMemoryOwner(meta?.userId) : null;
  return {
    type,
    chunk,
    excerpt,
    userId,
    ownerState: userId ? "owned" : ownerState === "conflict" ? "conflict" : "unowned",
  };
}

function extractSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^##\s+(\w+)\s*$/gm;
  const matches = [...body.matchAll(re)];
  for (let i = 0; i < matches.length; i++) {
    const name = matches[i]![1]!;
    const start = matches[i]!.index! + matches[i]![0]!.length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : body.length;
    const text = body.slice(start, end).trim();
    if (text) out[name] = text;
  }
  return out;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (!(denom > 0)) return 0;
  return dot / denom;
}

function float32ToBuffer(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function bufferToFloat32(buf: Buffer): Float32Array {
  const copy = Buffer.from(buf);
  return new Float32Array(copy.buffer, copy.byteOffset, copy.byteLength / 4);
}

let dbModule: typeof Database | null = null;
let dbLoadError: string | null = null;
let dbLoadPromise: Promise<typeof Database> | null = null;

async function getDatabaseModule(): Promise<typeof Database> {
  if (dbModule) return dbModule;
  if (dbLoadError) throw new Error(dbLoadError);
  if (!dbLoadPromise) {
    dbLoadPromise = (async () => {
      try {
        const mod = (await import("better-sqlite3")) as {
          default: typeof Database;
        };
        dbModule = mod.default;
        return mod.default;
      } catch (err) {
        dbLoadError = err instanceof Error ? err.message : String(err);
        dbLoadPromise = null;
        throw err;
      }
    })();
  }
  return dbLoadPromise;
}

function readMeta(db: Database.Database, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

/**
 * Create or upgrade the derived schema. Rows written under an older schema
 * have no verified owner, so they are dropped (not readable by any user)
 * until a rebuild reconstructs them from owned notes. The old completed
 * flag is cleared so readiness cannot be inherited from a global index.
 */
function ensureSchema(db: Database.Database): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  const upgrade = db.transaction(() => {
    const hasTable =
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memories'",
        )
        .get() !== undefined;
    const version = readMeta(db, META_SCHEMA_KEY);
    if (hasTable && version !== MEMORY_INDEX_SCHEMA_VERSION) {
      db.exec("DROP TABLE memories");
      db.prepare("DELETE FROM meta WHERE key IN (?, ?)").run(
        LEGACY_READY_KEY,
        META_READY_KEY,
      );
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        path TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        mtime_ms INTEGER NOT NULL,
        indexed_at_ms INTEGER NOT NULL,
        content_hash TEXT NOT NULL,
        embedding BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memory_deletions (
        path TEXT PRIMARY KEY,
        mtime_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_user_type ON memories(user_id, type);
    `);
    writeMeta(db, META_SCHEMA_KEY, MEMORY_INDEX_SCHEMA_VERSION);
  });
  upgrade();
}

async function openDb(dbPath: string): Promise<Database.Database> {
  const DatabaseCtor = await getDatabaseModule();
  const db = new DatabaseCtor(dbPath);
  try {
    ensureSchema(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

type IndexRow = {
  path: string;
  user_id: string;
  type: MemoryType;
  excerpt: string;
  mtime_ms: number;
  indexed_at_ms: number;
  content_hash: string;
  embedding: Buffer;
};

const UPSERT_SQL = `INSERT INTO memories
 (path, user_id, type, excerpt, mtime_ms, indexed_at_ms, content_hash, embedding)
 SELECT
   @path, @user_id, @type, @excerpt, @mtime_ms, @indexed_at_ms, @content_hash, @embedding
 WHERE NOT EXISTS (
   SELECT 1 FROM memory_deletions
   WHERE path = @path AND mtime_ms >= @mtime_ms
 )
 ON CONFLICT(path) DO UPDATE SET
   user_id = excluded.user_id,
   type = excluded.type,
   excerpt = excluded.excerpt,
   mtime_ms = excluded.mtime_ms,
   indexed_at_ms = excluded.indexed_at_ms,
   content_hash = excluded.content_hash,
   embedding = excluded.embedding`;

const UPSERT_GUARD_SQL = `
 AND NOT EXISTS (
   SELECT 1 FROM memory_deletions
   WHERE path = excluded.path AND mtime_ms >= excluded.mtime_ms
 )`;

/** Owner participates in the hash so an owner-only edit is never a no-op. */
function contentHash(userId: string, text: string): string {
  return createHash("sha256")
    .update(userId)
    .update("\n")
    .update(text)
    .digest("hex")
    .slice(0, 16);
}

type PreparedNote = {
  path: string;
  userId: string;
  type: MemoryType;
  excerpt: string;
  mtime_ms: number;
  content_hash: string;
  chunk: string;
};

/** Parse one note into an index row; null when it cannot be indexed. */
function prepareNote(opts: {
  path: string;
  markdown: string;
  mtimeMs: number;
  fallbackType?: MemoryType;
}): { row: PreparedNote } | { reason: "unowned" | "empty" } {
  const parsed = parseKnowledgeNote(opts.markdown);
  if (!parsed.userId) return { reason: "unowned" };
  if (!parsed.chunk.trim()) return { reason: "empty" };
  const type = parsed.type ?? opts.fallbackType ?? "interaction";
  return {
    row: {
      path: resolve(opts.path),
      userId: parsed.userId,
      type,
      excerpt: parsed.excerpt || basename(opts.path),
      mtime_ms: Math.round(opts.mtimeMs),
      content_hash: contentHash(parsed.userId, parsed.chunk),
      chunk: parsed.chunk,
    },
  };
}

function toIndexRow(
  row: PreparedNote,
  vec: Float32Array,
  indexedAtMs: number,
): IndexRow {
  return {
    path: row.path,
    user_id: row.userId,
    type: row.type,
    excerpt: row.excerpt,
    mtime_ms: row.mtime_ms,
    indexed_at_ms: indexedAtMs,
    content_hash: row.content_hash,
    embedding: float32ToBuffer(vec),
  };
}

/** Deterministic hash embedder for tests (no model download). */
export function createHashEmbedder(dimensions = DEFAULT_DIMS): Embedder {
  return {
    dimensions,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map((text) => {
        const vec = new Float32Array(dimensions);
        const h = createHash("sha256").update(text).digest();
        for (let i = 0; i < dimensions; i++) {
          // Spread bytes + position so similar prefixes still vary.
          const b = h[i % h.length]!;
          vec[i] = ((b + i * 17) % 256) / 127.5 - 1;
        }
        // L2 normalize
        let norm = 0;
        for (let i = 0; i < dimensions; i++) norm += vec[i]! * vec[i]!;
        norm = Math.sqrt(norm) || 1;
        for (let i = 0; i < dimensions; i++) vec[i]! /= norm;
        return vec;
      });
    },
  };
}

/**
 * Lazy-load Xenova MiniLM. Soft-fails: subsequent calls reuse the error string.
 */
export async function getDefaultEmbedder(): Promise<Embedder> {
  if (cachedEmbedder) return cachedEmbedder;
  if (embedderLoadError) {
    throw new Error(embedderLoadError);
  }
  if (!embedderPromise) {
    embedderPromise = (async () => {
      try {
        const { pipeline } = await import("@xenova/transformers");
        const extractor = await pipeline("feature-extraction", DEFAULT_MODEL);
        const embedder: Embedder = {
          dimensions: DEFAULT_DIMS,
          async embed(texts: string[]): Promise<Float32Array[]> {
            try {
              const out: Float32Array[] = [];
              for (const text of texts) {
                const result = await extractor(text, {
                  pooling: "mean",
                  normalize: true,
                });
                const data = result.data as Float32Array | number[];
                out.push(
                  data instanceof Float32Array
                    ? data
                    : Float32Array.from(data as number[]),
                );
              }
              return out;
            } catch (err) {
              cachedEmbedder = null;
              embedderPromise = null;
              throw err;
            }
          },
        };
        cachedEmbedder = embedder;
        return embedder;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Failed to load embedding model";
        embedderLoadError = `Embedding model unavailable (${DEFAULT_MODEL}): ${msg}`;
        embedderPromise = null;
        throw new Error(embedderLoadError);
      }
    })();
  }
  return embedderPromise;
}

/** Reset cached embedder (tests). */
export function resetEmbedderCache(): void {
  cachedEmbedder = null;
  embedderLoadError = null;
  embedderPromise = null;
}

async function resolveEmbedder(embedder?: Embedder): Promise<Embedder> {
  if (embedder) return embedder;
  return getDefaultEmbedder();
}

/**
 * Full rebuild from canonical owned notes (C07 enumeration, legacy aliases
 * collapsed). Embeds everything first, then publishes in one locked
 * transaction: rows written by a concurrent upsert after the rebuild
 * started are kept, and a newer file read always wins by mtime. Readiness
 * is recorded only after the whole snapshot is published.
 */
export async function reindexMemory(opts?: {
  knowledgeRoot?: string;
  indexDir?: string;
  embedder?: Embedder;
}): Promise<ReindexResult> {
  const paths = resolveIndexPaths(opts);
  let embedder: Embedder;
  try {
    embedder = await resolveEmbedder(opts?.embedder);
  } catch (err) {
    return {
      ok: false,
      indexed: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await mkdir(paths.indexDir, { recursive: true });
    const startedAtMs = Date.now();
    let skipped = 0;
    let excluded = 0;
    const prepared: PreparedNote[] = [];
    for (const kind of ["interaction", "dismissal"] as const) {
      const notes = await enumerateMemoryNotes({
        knowledgeRoot: paths.knowledgeRoot,
        kind,
        migrate: true,
      });
      for (const note of notes) {
        try {
          const st = await stat(note.path);
          const result = prepareNote({
            path: note.path,
            markdown: note.markdown,
            mtimeMs: st.mtimeMs,
            fallbackType: kind,
          });
          if ("row" in result) prepared.push(result.row);
          else if (result.reason === "unowned") excluded++;
          else skipped++;
        } catch {
          skipped++;
        }
      }
    }

    const rows: IndexRow[] = [];
    const batchSize = 8;
    for (let i = 0; i < prepared.length; i += batchSize) {
      const batch = prepared.slice(i, i + batchSize);
      const vectors = await embedder.embed(batch.map((r) => r.chunk));
      for (let j = 0; j < batch.length; j++) {
        const vec = vectors[j];
        if (!vec) throw new Error("embed returned too few vectors");
        rows.push(toIndexRow(batch[j]!, vec, startedAtMs));
      }
    }

    await withFileLock(paths.dbPath, async () => {
      const db = await openDb(paths.dbPath);
      try {
        const publish = db.transaction(() => {
          // Rows older than this snapshot are stale; concurrent upserts stay.
          db.prepare("DELETE FROM memories WHERE indexed_at_ms < ?").run(
            startedAtMs,
          );
          // A row upserted during the rebuild read the file at least as
          // recently as this snapshot; only a strictly newer read replaces it.
           const insert = db.prepare(
             `${UPSERT_SQL}
             WHERE excluded.mtime_ms > memories.mtime_ms${UPSERT_GUARD_SQL}`,
           );
           for (const row of rows) insert.run(row);
           db.prepare("DELETE FROM memory_deletions WHERE mtime_ms <= ?").run(
             startedAtMs,
           );
          db.prepare("DELETE FROM meta WHERE key = ?").run(LEGACY_READY_KEY);
          writeMeta(db, META_READY_KEY, MEMORY_INDEX_SCHEMA_VERSION);
        });
        publish();
      } finally {
        db.close();
      }
    });

    return { ok: true, indexed: rows.length, skipped, excluded };
  } catch (err) {
    return {
      ok: false,
      indexed: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Index one note. A note whose owner cannot be verified is removed from the
 * index (an ownership edit must never leave a stale row behind). An older
 * read never overwrites a newer row (mtime), so a slow upsert cannot undo a
 * rebuild that already published fresher content.
 */
export async function upsertMemoryNote(
  notePath: string,
  opts?: {
    knowledgeRoot?: string;
    indexDir?: string;
    embedder?: Embedder;
    type?: MemoryType;
  },
): Promise<UpsertResult> {
  const paths = resolveIndexPaths(opts);
  let embedder: Embedder;
  try {
    embedder = await resolveEmbedder(opts?.embedder);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    await mkdir(paths.indexDir, { recursive: true });
    const markdown = await readFile(notePath, "utf8");
    const st = await stat(notePath);
    const fallbackType =
      opts?.type ??
      (/dismissals[/\\]/.test(notePath) ? "dismissal" : "interaction");
    const result = prepareNote({
      path: notePath,
      markdown,
      mtimeMs: st.mtimeMs,
      fallbackType,
    });
    if (!("row" in result)) {
      if (result.reason === "unowned") {
        await withFileLock(paths.dbPath, async () => {
          const db = await openDb(paths.dbPath);
          try {
            const path = resolve(notePath);
            db.transaction(() => {
              db.prepare(
                `INSERT INTO memory_deletions (path, mtime_ms) VALUES (?, ?)
                 ON CONFLICT(path) DO UPDATE SET mtime_ms = MAX(memory_deletions.mtime_ms, excluded.mtime_ms)`,
              ).run(path, Math.round(st.mtimeMs));
              db.prepare("DELETE FROM memories WHERE path = ?").run(path);
            })();
          } finally {
            db.close();
          }
        });
        return {
          ok: false,
          path: notePath,
          error: "note has no verified owner; excluded from index",
        };
      }
      return { ok: false, path: notePath, error: "empty note chunk" };
    }
    const row = result.row;
    if (opts?.type) row.type = opts.type;
    const [vec] = await embedder.embed([row.chunk]);
    if (!vec) {
      return { ok: false, path: notePath, error: "embed failed" };
    }

    await withFileLock(paths.dbPath, async () => {
      const db = await openDb(paths.dbPath);
      try {
        db.prepare("DELETE FROM memory_deletions WHERE path = ? AND mtime_ms <= ?").run(
          row.path,
          Math.round(row.mtime_ms),
        );
        db.prepare(
          `${UPSERT_SQL}
           WHERE excluded.mtime_ms >= memories.mtime_ms${UPSERT_GUARD_SQL}`,
        ).run(toIndexRow(row, vec, Date.now()));
      } finally {
        db.close();
      }
    });
    return { ok: true, path: row.path };
  } catch (err) {
    return {
      ok: false,
      path: notePath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Owner-scoped nearest-neighbour search. The `user_id = ?` filter runs in
 * SQL before any scoring or top-k, so a foreign note with a higher
 * similarity can never enter the candidate set. Missing identity fails
 * closed before touching the model or the database.
 */
export async function searchMemory(
  opts: SearchMemoryOpts,
): Promise<SearchMemoryResult> {
  const userId = normalizeMemoryOwner(opts.userId);
  if (!userId) return { hits: [], error: "memory search requires a user" };
  const query = opts.query?.trim() ?? "";
  if (!query) return { hits: [] };

  const k = Math.max(1, Math.min(opts.k ?? 4, 20));
  const paths = resolveIndexPaths(opts);

  let embedder: Embedder;
  try {
    embedder = await resolveEmbedder(opts.embedder);
  } catch (err) {
    return { hits: [], error: err instanceof Error ? err.message : String(err) };
  }

  let db: Database.Database;
  try {
    db = await openDb(paths.dbPath);
  } catch (err) {
    return { hits: [], error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const typeFilter = opts.types?.length
      ? opts.types
      : (["interaction", "dismissal"] as MemoryType[]);
    const placeholders = typeFilter.map(() => "?").join(",");
    const rows = db
      .prepare(
        `SELECT path, type, excerpt, embedding FROM memories
         WHERE user_id = ? AND type IN (${placeholders})`,
      )
      .all(userId, ...typeFilter) as {
      path: string;
      type: string;
      excerpt: string;
      embedding: Buffer;
    }[];

    if (!rows.length) return { hits: [] };

    const [qVec] = await embedder.embed([truncate(query, MAX_CHUNK_CHARS)]);
    if (!qVec) return { hits: [], error: "query embed failed" };

    const scored: MemoryHit[] = [];
    for (const row of rows) {
      if (row.type !== "interaction" && row.type !== "dismissal") continue;
      try {
        const vec = bufferToFloat32(row.embedding);
        scored.push({
          path: row.path,
          type: row.type,
          score: cosineSimilarity(qVec, vec),
          excerpt: row.excerpt,
        });
      } catch {
        // skip corrupt row
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return { hits: scored.slice(0, k) };
  } catch (err) {
    return { hits: [], error: err instanceof Error ? err.message : String(err) };
  } finally {
    db.close();
  }
}

/**
 * Lightweight readiness probe (no model download). `dbIndexed` is true only
 * when a complete rebuild has been published under the current schema; the
 * pre-C08 global flag never counts.
 */
export async function memoryIndexStatus(opts?: {
  knowledgeRoot?: string;
  indexDir?: string;
}): Promise<{
  indexDir: string;
  dbPath: string;
  dbExists: boolean;
  dbIndexed: boolean;
  schemaVersion: string;
  modelCached: boolean;
  modelError: string | null;
}> {
  const paths = resolveIndexPaths(opts);
  let dbIndexed = false;
  if (existsSync(paths.dbPath)) {
    try {
      const db = await openDb(paths.dbPath);
      try {
        dbIndexed = readMeta(db, META_READY_KEY) === MEMORY_INDEX_SCHEMA_VERSION;
      } finally {
        db.close();
      }
    } catch {
      dbIndexed = false;
    }
  }
  return {
    indexDir: paths.indexDir,
    dbPath: paths.dbPath,
    dbExists: existsSync(paths.dbPath),
    dbIndexed,
    schemaVersion: MEMORY_INDEX_SCHEMA_VERSION,
    modelCached: cachedEmbedder !== null,
    modelError: embedderLoadError,
  };
}
