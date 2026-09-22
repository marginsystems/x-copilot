import { objectValue } from "../platform/unknownValue.js";
/**
 * Expired / skipped / dismissed history routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  listDismissalHistory,
  markDismissed,
} from "./dismissalStore.js";
import { listExpiredHistory } from "./expiredStore.js";
import { BodyError, readBody, send } from "../http/httpJson.js";
import { normalizeAuthorKey } from "./interactionCooldown.js";
import { writeDismissalMemory } from "../memory/knowledgeMemory.js";
import { scheduleMemoryUpsert } from "../memory/memoryReindex.js";
import { pruneThreadsFromScoutCache } from "../scout/scoutCache.js";
import { maybeStartEmptyTankScout } from "../scout/scoutEmptyTank.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { listSkipHistory, markSkipped } from "./skipStore.js";
import { explicitScoutActionEvidence } from "../scout/scoutEvidenceRecord.js";

const NO_STORE = { "Cache-Control": "no-store" };

export type DismissalMemoryResult = {
  state: "saved" | "unavailable";
  memoryPath?: string;
};

type HistoryHttpDeps = {
  markDismissed: typeof markDismissed;
  writeDismissalNote: typeof writeDismissalMemory;
  scheduleUpsert: typeof scheduleMemoryUpsert;
  knowledgeRoot?: string;
};

const defaultDeps: HistoryHttpDeps = {
  markDismissed,
  writeDismissalNote: writeDismissalMemory,
  scheduleUpsert: scheduleMemoryUpsert,
};

let deps: HistoryHttpDeps = { ...defaultDeps };

/** Test seams: inject durable-store, note and index failures; isolate note writes. */
export function resetHistoryHttpForTests(
  overrides?: Partial<HistoryHttpDeps>,
): void {
  deps = { ...defaultDeps, ...overrides };
}

/**
 * Owned dismissal note after the durable action. Isolated soft-failure: a
 * note or index problem yields `unavailable`, never a failed dismissal.
 */
async function projectDismissalMemory(
  input: Parameters<typeof writeDismissalMemory>[0],
): Promise<DismissalMemoryResult> {
  let memory: { path: string };
  try {
    memory = await deps.writeDismissalNote({
      ...input,
      knowledgeRoot: input.knowledgeRoot ?? deps.knowledgeRoot,
    });
  } catch (err) {
    console.warn("dismissal memory write unavailable:", err);
    return { state: "unavailable" };
  }
  try {
    void Promise.resolve(deps.scheduleUpsert(memory.path, "dismissal")).catch(
      (err) => {
        console.warn("dismissal memory schedule soft-fail:", err);
      },
    );
  } catch (err) {
    console.warn("dismissal memory schedule soft-fail:", err);
  }
  return { state: "saved", memoryPath: memory.path };
}

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
      body = objectValue((await readBody(req)));
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
      const conversationId =
        typeof body.conversationId === "string"
          ? body.conversationId
          : undefined;
      const inReplyToId =
        typeof body.inReplyToId === "string" ? body.inReplyToId : undefined;
      let evidence;
      try {
        evidence = await explicitScoutActionEvidence({
          userId: user.id,
          action: "skip",
          surface: "scout",
          cardId: threadId,
          source: "scout",
          targetId: threadId,
          conversationId,
          inReplyToId,
          fallbackText: [text, summary].filter(Boolean).join(" "),
          fallbackAuthor: author,
        });
      } catch (err) {
        console.warn("Scout skip evidence capture soft-fail:", err);
      }
      const skip = await markSkipped({
        threadId,
        author,
        userId: user.id,
        url: urlField,
        text,
        summary,
        conversationId,
        inReplyToId,
        evidence,
      });
      await pruneThreadsFromScoutCache(
        [skip.threadId, skip.conversationId ?? "", skip.inReplyToId ?? ""],
        { userId: user.id },
      );
      maybeStartEmptyTankScout(user.id).catch((err: unknown) => {
        console.warn("Empty-tank scout soft-fail:", err);
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
      body = objectValue((await readBody(req)));
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
      // Durable action first: SQL failure is the only thing that fails the
      // request. The owned note is keyed by the durable action time.
      let evidence;
      try {
        evidence = await explicitScoutActionEvidence({
          userId: user.id,
          action: "dismiss",
          surface: "scout",
          cardId: threadId,
          source: "scout",
          targetId: threadId,
          conversationId,
          inReplyToId,
          fallbackText: [text, summary].filter(Boolean).join(" "),
          fallbackAuthor: author,
        });
      } catch (err) {
        console.warn("Scout dismissal evidence capture soft-fail:", err);
      }
      const dismissal = await deps.markDismissed({
        threadId,
        author,
        userId: user.id,
        url: urlField,
        text,
        summary,
        reason,
        conversationId,
        inReplyToId,
        nowMs: Date.now(),
        evidence,
      });
      const memory = await projectDismissalMemory({
        threadId,
        author,
        userId: user.id,
        url: urlField,
        text,
        summary,
        opAuthor,
        opText,
        reason,
        dismissedAt: dismissal.at,
      });
      await pruneThreadsFromScoutCache(
        [
          dismissal.threadId,
          dismissal.conversationId ?? "",
          dismissal.inReplyToId ?? "",
        ],
        { userId: user.id },
      );
      maybeStartEmptyTankScout(user.id).catch((err: unknown) => {
        console.warn("Empty-tank scout soft-fail:", err);
      });
      send(req, res, 200, {
        ok: true,
        dismissal,
        memory: { state: memory.state },
        ...(memory.memoryPath ? { memoryPath: memory.memoryPath } : {}),
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
