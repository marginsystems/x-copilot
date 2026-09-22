/**
 * Local-only memory search + reindex.
 *
 * Search is owner-scoped: the only identity it accepts is the authenticated
 * session user. A body-supplied userId/tenantId is rejected rather than
 * honored. Reindex stays an administrative, origin-gated rebuild that
 * returns counts only — never note contents.
 */
import { objectValue } from "../platform/unknownValue.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getSessionUser } from "../auth/sessionCookie.js";
import { isLocalOrigin } from "../http/cors.js";
import { BodyError, readBody, send } from "../http/httpJson.js";
import { searchMemory } from "./memoryIndex.js";
import {
  ensureMemoryIndex,
  parseMemoryTypes,
  runMemoryReindex,
} from "./memoryReindex.js";

/** Injectable seams (tests). Production uses the module defaults. */
export type MemoryHttpDeps = {
  searchMemory?: typeof searchMemory;
  ensureMemoryIndex?: typeof ensureMemoryIndex;
  runMemoryReindex?: typeof runMemoryReindex;
};

/** Body keys that would select an identity; the session is the only owner. */
const FORBIDDEN_IDENTITY_KEYS = ["userId", "tenantId"] as const;

function originHeader(req: IncomingMessage): string | undefined {
  return typeof req.headers.origin === "string" ? req.headers.origin : undefined;
}

export async function tryHandleMemory(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: MemoryHttpDeps = {},
): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/memory/search") {
    if (!isLocalOrigin(originHeader(req))) {
      send(req, res, 403, {
        error: "forbidden",
        message: "Origin not allowed",
      });
      return true;
    }
    const user = getSessionUser(req);
    if (!user) {
      send(req, res, 401, {
        error: "unauthenticated",
        message: "Sign in required",
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = objectValue(await readBody(req, { requireObject: true }));
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const forged = FORBIDDEN_IDENTITY_KEYS.filter((key) => key in body);
    if (forged.length) {
      send(req, res, 400, {
        error: "bad_request",
        message: `Do not pass ${forged.join(" or ")}; memory search is scoped to the signed-in user.`,
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
    await (deps.ensureMemoryIndex ?? ensureMemoryIndex)();
    const result = await (deps.searchMemory ?? searchMemory)({
      userId: user.id,
      query,
      k,
      types,
    });
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
    if (!isLocalOrigin(originHeader(req))) {
      send(req, res, 403, {
        error: "forbidden",
        message: "Origin not allowed",
      });
      return true;
    }
    const result = await (deps.runMemoryReindex ?? runMemoryReindex)();
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
      ...(typeof result.excluded === "number" ? { excluded: result.excluded } : {}),
    });
    return true;
  }

  return false;
}
