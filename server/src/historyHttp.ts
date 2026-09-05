/**
 * Expired / skipped / dismissed history routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  listDismissalHistory,
  markDismissed,
} from "./dismissalStore.js";
import { listExpiredHistory } from "./expiredStore.js";
import { BodyError, readBody, send } from "./httpJson.js";
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { writeDismissalMemory } from "./knowledgeMemory.js";
import { scheduleMemoryUpsert } from "./memoryReindex.js";
import { getSessionUser } from "./sessionCookie.js";
import { listSkipHistory, markSkipped } from "./skipStore.js";

const NO_STORE = { "Cache-Control": "no-store" };

function sendUnauthenticated(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  send(
    req,
    res,
    401,
    { error: "unauthenticated", message: "Sign in required" },
    NO_STORE,
  );
}

/**
 * Skip / Not interested / Expired history is per user. GET without a
 * session is an empty desk; POST without a session is rejected.
 */
export async function tryHandleHistory(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/expired") {
    const user = getSessionUser(req);
    const expired = user ? await listExpiredHistory({ userId: user.id }) : [];
    send(req, res, 200, {
      expired,
      expiredIds: expired.map((e) => e.threadId),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/dismissed") {
    const user = getSessionUser(req);
    const dismissals = user
      ? await listDismissalHistory({ userId: user.id })
      : [];
    send(req, res, 200, {
      dismissals: dismissals.map(({ authorKey, ...rest }) => rest),
      dismissedIds: dismissals.map((d) => d.threadId),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/skipped") {
    const user = getSessionUser(req);
    const skipped = user ? await listSkipHistory({ userId: user.id }) : [];
    send(req, res, 200, {
      skipped: skipped.map(({ authorKey, ...rest }) => rest),
      skippedIds: skipped.map((d) => d.threadId),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/skipped") {
    const user = getSessionUser(req);
    if (!user) {
      sendUnauthenticated(req, res);
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
    const threadId =
      typeof body.threadId === "string" ? body.threadId.trim() : "";
    const author = typeof body.author === "string" ? body.author.trim() : "";
    if (!threadId || !author || !normalizeAuthorKey(author)) {
      send(req, res, 400, {
        error: "bad_request",
        message: "Pass { threadId: string, author: string }.",
      });
      return true;
    }
    try {
      const urlField = typeof body.url === "string" ? body.url : undefined;
      const text = typeof body.text === "string" ? body.text : undefined;
      const summary =
        typeof body.summary === "string" ? body.summary : undefined;
      const skip = await markSkipped({
        threadId,
        author,
        userId: user.id,
        url: urlField,
        text,
        summary,
      });
      const { authorKey: _authorKey, ...skipRest } = skip;
      send(req, res, 200, {
        ok: true,
        skip: skipRest,
      });
      return true;
    } catch (err) {
      console.error("Failed to store skip:", err);
      send(req, res, 500, {
        error: "store_failed",
        message: "Failed to store skip",
      });
      return true;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/dismissed") {
    const user = getSessionUser(req);
    if (!user) {
      sendUnauthenticated(req, res);
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
    const threadId =
      typeof body.threadId === "string" ? body.threadId.trim() : "";
    const author = typeof body.author === "string" ? body.author.trim() : "";
    if (!threadId || !author || !normalizeAuthorKey(author)) {
      send(req, res, 400, {
        error: "bad_request",
        message: "Pass { threadId: string, author: string }.",
      });
      return true;
    }
    try {
      const urlField = typeof body.url === "string" ? body.url : undefined;
      const text = typeof body.text === "string" ? body.text : undefined;
      const summary =
        typeof body.summary === "string" ? body.summary : undefined;
      const opAuthor =
        typeof body.opAuthor === "string" ? body.opAuthor : undefined;
      const opText =
        typeof body.opText === "string" ? body.opText : undefined;
      const reason =
        typeof body.reason === "string" ? body.reason : undefined;
      const conversationId =
        typeof body.conversationId === "string"
          ? body.conversationId
          : undefined;
      const inReplyToId =
        typeof body.inReplyToId === "string" ? body.inReplyToId : undefined;
      const nowMs = Date.now();
      const dismissedAt = new Date(nowMs).toISOString();
      const memory = await writeDismissalMemory({
        threadId,
        author,
        url: urlField,
        text,
        summary,
        opAuthor,
        opText,
        reason,
        dismissedAt,
      });
      scheduleMemoryUpsert(memory.path, "dismissal");
      const dismissal = await markDismissed({
        threadId,
        author,
        userId: user.id,
        url: urlField,
        text,
        summary,
        reason,
        conversationId,
        inReplyToId,
        nowMs,
      });
      send(req, res, 200, {
        ok: true,
        dismissal,
        memoryPath: memory.path,
      });
      return true;
    } catch (err) {
      console.error("Failed to store dismissal:", err);
      send(req, res, 500, {
        error: "store_failed",
        message: "Failed to store dismissal",
      });
      return true;
    }
  }

  return false;
}
