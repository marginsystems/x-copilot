/**
 * Local embedding index over knowledge/{interactions,dismissals}.
 * Advisory retrieval for Scout triage — soft-fails when model/index unavailable.
 */
/// <reference path="./xenova-transformers.d.ts" />
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type Database from "better-sqlite3";
import { defaultKnowledgeRoot, projectRoot } from "./knowledgeMemory.js";

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

/** Extract ## Section bodies and frontmatter type from a knowledge note. */
export function parseKnowledgeNote(markdown: string): {
  type: MemoryType | null;
  chunk: string;
  excerpt: string;
} {
  const trimmed = markdown.replace(/^\uFEFF/, "");
  let body = trimmed;
  let type: MemoryType | null = null;

  if (trimmed.startsWith("---")) {
    const end = trimmed.indexOf("\n---", 3);
    if (end >= 0) {
      const fm = trimmed.slice(3, end).trim();
      const typeMatch = /^type:\s*["']?(interaction|dismissal)["']?\s*$/m.exec(fm);
      if (typeMatch) type = typeMatch[1] as MemoryType;
      body = trimmed.slice(end + 4).replace(/^\s*\n/, "");
    }
  }

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
  return { type, chunk, excerpt };
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

async function openDb(dbPath: string): Promise<Database.Database> {
  const DatabaseCtor = await getDatabaseModule();
  const db = new DatabaseCtor(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      path TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      excerpt TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      embedding BLOB NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  return db;
}

async function listNoteFiles(knowledgeRoot: string): Promise<
  { path: string; type: MemoryType }[]
> {
  const out: { path: string; type: MemoryType }[] = [];
  for (const type of ["interaction", "dismissal"] as const) {
    const dir = join(
      knowledgeRoot,
      type === "interaction" ? "interactions" : "dismissals",
    );
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue;
      throw err;
    }
    for (const name of names) {
      if (!name.endsWith(".md")) continue;
      out.push({ path: join(dir, name), type });
    }
  }
  return out;
}

function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
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
    const files = await listNoteFiles(paths.knowledgeRoot);
    const db = await openDb(paths.dbPath);
    try {
      db.exec("DELETE FROM memories");
      const insert = db.prepare(
        `INSERT INTO memories (path, type, excerpt, mtime_ms, content_hash, embedding)
         VALUES (@path, @type, @excerpt, @mtime_ms, @content_hash, @embedding)
         ON CONFLICT(path) DO UPDATE SET
           type = excluded.type,
           excerpt = excluded.excerpt,
           mtime_ms = excluded.mtime_ms,
           content_hash = excluded.content_hash,
           embedding = excluded.embedding`,
      );

      let indexed = 0;
      let skipped = 0;
      const batchSize = 8;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        const rows: {
          path: string;
          type: MemoryType;
          excerpt: string;
          mtime_ms: number;
          content_hash: string;
          chunk: string;
        }[] = [];

        for (const file of batch) {
          try {
            const markdown = await readFile(file.path, "utf8");
            const parsed = parseKnowledgeNote(markdown);
            const type = parsed.type ?? file.type;
            if (!parsed.chunk.trim()) {
              skipped++;
              continue;
            }
            const st = await stat(file.path);
            rows.push({
              path: file.path,
              type,
              excerpt: parsed.excerpt || basename(file.path),
              mtime_ms: Math.round(st.mtimeMs),
              content_hash: contentHash(parsed.chunk),
              chunk: parsed.chunk,
            });
          } catch {
            skipped++;
          }
        }

        if (!rows.length) continue;
        const vectors = await embedder.embed(rows.map((r) => r.chunk));
        const tx = db.transaction(() => {
          for (let j = 0; j < rows.length; j++) {
            const row = rows[j]!;
            const vec = vectors[j]!;
            insert.run({
              path: row.path,
              type: row.type,
              excerpt: row.excerpt,
              mtime_ms: row.mtime_ms,
              content_hash: row.content_hash,
              embedding: float32ToBuffer(vec),
            });
            indexed++;
          }
        });
        tx();
      }

      if (indexed > 0) {
        db.prepare(
          `INSERT INTO meta (key, value) VALUES ('indexed_at', '1')
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ).run();
      }

      return { ok: true, indexed, skipped };
    } finally {
      db.close();
    }
  } catch (err) {
    return {
      ok: false,
      indexed: 0,
      skipped: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

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
    const parsed = parseKnowledgeNote(markdown);
    const type =
      opts?.type ??
      parsed.type ??
      (/dismissals[/\\]/.test(notePath) ? "dismissal" : "interaction");
    if (!parsed.chunk.trim()) {
      return { ok: false, path: notePath, error: "empty note chunk" };
    }
    const st = await stat(notePath);
    const [vec] = await embedder.embed([parsed.chunk]);
    if (!vec) {
      return { ok: false, path: notePath, error: "embed failed" };
    }

    const db = await openDb(paths.dbPath);
    try {
      db.prepare(
        `INSERT INTO memories (path, type, excerpt, mtime_ms, content_hash, embedding)
         VALUES (@path, @type, @excerpt, @mtime_ms, @content_hash, @embedding)
         ON CONFLICT(path) DO UPDATE SET
           type = excluded.type,
           excerpt = excluded.excerpt,
           mtime_ms = excluded.mtime_ms,
           content_hash = excluded.content_hash,
           embedding = excluded.embedding`,
      ).run({
        path: resolve(notePath),
        type,
        excerpt: parsed.excerpt || basename(notePath),
        mtime_ms: Math.round(st.mtimeMs),
        content_hash: contentHash(parsed.chunk),
        embedding: float32ToBuffer(vec),
      });
    } finally {
      db.close();
    }
    return { ok: true, path: resolve(notePath) };
  } catch (err) {
    return {
      ok: false,
      path: notePath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function searchMemory(
  opts: SearchMemoryOpts,
): Promise<SearchMemoryResult> {
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
        `SELECT path, type, excerpt, embedding FROM memories WHERE type IN (${placeholders})`,
      )
      .all(...typeFilter) as {
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

/** Lightweight readiness probe (no model download). */
export async function memoryIndexStatus(opts?: {
  knowledgeRoot?: string;
  indexDir?: string;
}): Promise<{
  indexDir: string;
  dbPath: string;
  dbExists: boolean;
  dbIndexed: boolean;
  modelCached: boolean;
  modelError: string | null;
}> {
  const paths = resolveIndexPaths(opts);
  let dbIndexed = false;
  if (existsSync(paths.dbPath)) {
    try {
      const db = await openDb(paths.dbPath);
      try {
        dbIndexed =
          db.prepare("SELECT 1 FROM meta WHERE key = 'indexed_at'").get() !==
          undefined;
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
    modelCached: cachedEmbedder !== null,
    modelError: embedderLoadError,
  };
}
