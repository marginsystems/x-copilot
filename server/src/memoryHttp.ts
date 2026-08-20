/**
 * Local-only memory search + reindex.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isLocalOrigin } from "./cors.js";
import { BodyError, readBody, send } from "./httpJson.js";
import { searchMemory } from "./memoryIndex.js";
import {
  ensureMemoryIndex,
  parseMemoryTypes,
  runMemoryReindex,
} from "./memoryReindex.js";

export async function tryHandleMemory(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/memory/search") {
    if (!isLocalOrigin(typeof req.headers.origin === "string" ? req.headers.origin : undefined)) {
      send(req, res, 403, {
        error: "forbidden",
        message: "Origin not allowed",
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      send(req, res, 400, {
        error: "bad_request",
        message: 'Pass { query: string, k?: number, types?: ("interaction"|"dismissal")[] }.',
      });
      return true;
    }
    const k =
      typeof body.k === "number" && Number.isFinite(body.k)
        ? Math.max(1, Math.min(20, Math.round(body.k)))
        : undefined;
    const types = parseMemoryTypes(body.types);
    await ensureMemoryIndex();
    const result = await searchMemory({ query, k, types });
    if (result.error) {
      send(req, res, 503, {
        ok: false,
        error: "memory_unavailable",
        message: result.error,
        hits: result.hits,
      });
      return true;
    }
    send(req, res, 200, { ok: true, hits: result.hits });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/memory/reindex") {
    if (!isLocalOrigin(typeof req.headers.origin === "string" ? req.headers.origin : undefined)) {
      send(req, res, 403, {
        error: "forbidden",
        message: "Origin not allowed",
      });
      return true;
    }
    const result = await runMemoryReindex();
    if (!result.ok) {
      send(req, res, 503, {
        error: "reindex_failed",
        message: result.error ?? "Failed to reindex memory",
        indexed: result.indexed,
        skipped: result.skipped,
      });
      return true;
    }
    send(req, res, 200, {
      ok: true,
      indexed: result.indexed,
      skipped: result.skipped,
    });
    return true;
  }

  return false;
}
