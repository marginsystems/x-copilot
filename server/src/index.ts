/**
 * Local sidecar — holds X API bearer + LLM keys off the browser.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  bucketInteractions,
  parseActivityBucket,
} from "./activityStats.js";
import {
  getGamification,
  recordMarkGamification,
} from "./gamification.js";
import {
  filterThreadsByCooldown,
  getAuthorKeysForScoutFilter,
  listActiveInteractions,
  listInteractionHistory,
  markInteracted,
  MAX_INTERACTION_STORE,
  parseStatusIdFromUrl,
  normalizeAuthorKey,
  setGamificationSyncFailed,
} from "./interactionStore.js";
import {
  getBlockedConversationIds,
  getDismissedThreadIds,
  listDismissalHistory,
  markDismissed,
} from "./dismissalStore.js";
import { runExpirePass } from "./expirePass.js";
import {
  getExpiredThreadIds,
  listExpiredHistory,
} from "./expiredStore.js";
import {
  getSkippedThreadIds,
  listSkipHistory,
  markSkipped,
} from "./skipStore.js";
import {
  normalizeReply,
  writeDismissalMemory,
  writeInteractionMemory,
} from "./knowledgeMemory.js";
import {
  memoryIndexStatus,
  reindexMemory,
  searchMemory,
  upsertMemoryNote,
  type MemoryType,
  type ReindexResult,
} from "./memoryIndex.js";
import { loadEnv } from "./loadEnv.js";
import { getLastScout } from "./scoutCache.js";
import { endScout, tryBeginScout } from "./scoutGate.js";
import { appendScoutLog, getScoutLog } from "./scoutLog.js";
import {
  runScoutCollect,
  clampBucketSize,
  clampTargetCool,
} from "./scoutCollect.js";
import { runScoutSearch, type ScoutFilters } from "./scoutRun.js";
import {
  detectOwnReplyToThread,
  detectOwnReplyToThreadWithRetry,
  resolveDetectScreenName,
} from "./detectReply.js";
import { getPlatformDb, getLocalTenantId } from "./db.js";
import { getUsageSummary } from "./usageMeter.js";
import { getSessionFromEnv, verifySession } from "./xSession.js";
import { tryHandleAuth } from "./authHttp.js";
import { tryHandleOnboarding } from "./onboardingHttp.js";
import { corsHeaders, isLocalOrigin, isOriginAllowed, requestOrigin } from "./cors.js";
import { authRequired, bindHost, isPublicApiPath } from "./authGuard.js";
import { getSessionUser } from "./sessionCookie.js";
import { tryHandleAdmin } from "./adminHttp.js";
import {
  creditsExhaustedResponse,
  ensureUserTenant,
} from "./billingStore.js";
import { enterRequestContext, getRequestContext, getRequestTenantId } from "./requestContext.js";
import {
  tryHandleBilling,
  tryHandleStripeWebhook,
} from "./stripeHttp.js";

function parseScoutFilters(raw: unknown): ScoutFilters | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const filters: ScoutFilters = {};
  if (typeof obj.maxThreadChars === "number" && Number.isInteger(obj.maxThreadChars)) {
    filters.maxThreadChars = obj.maxThreadChars;
  }
  if (typeof obj.dropArticles === "boolean") {
    filters.dropArticles = obj.dropArticles;
  }
  if (typeof obj.dropEmDashes === "boolean") {
    filters.dropEmDashes = obj.dropEmDashes;
  }
  if (typeof obj.dropAutomatedAccounts === "boolean") {
    filters.dropAutomatedAccounts = obj.dropAutomatedAccounts;
  }
  if (obj.llmProvider === "deepseek" || obj.llmProvider === "gemini") {
    filters.llmProvider = obj.llmProvider;
  }
  if (typeof obj.dedupeAccounts === "boolean") {
    filters.dedupeAccounts = obj.dedupeAccounts;
  }
  if (typeof obj.preferredLanguage === "string" && obj.preferredLanguage.trim()) {
    filters.preferredLanguage = obj.preferredLanguage.trim().toLowerCase();
  }
  if (Array.isArray(obj.excludedTags)) {
    // Preserve explicit [] (no excludes); normalize tokens when present.
    filters.excludedTags = obj.excludedTags
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return Object.keys(filters).length ? filters : undefined;
}

loadEnv(resolve(process.cwd(), ".env"));

const PORT = Number(process.env.PORT || 8787);

try {
  getPlatformDb();
} catch (err) {
  console.error(
    "[db] platform migrate failed:",
    err instanceof Error ? err.message : String(err),
  );
}

/** Best-effort index upsert — never fails the request. */
function scheduleMemoryUpsert(notePath: string, type: MemoryType): void {
  void (async () => {
    if (memoryReindexInFlight) {
      await memoryReindexInFlight;
    }
    const result = await upsertMemoryNote(notePath, { type });
    if (!result.ok && result.error) {
      console.warn(`memory upsert soft-fail (${type}):`, result.error);
    }
  })();
}

/** Dedupe concurrent reindexes so only one full rebuild runs at a time. */
let memoryReindexInFlight: Promise<ReindexResult> | null = null;

/** Rebuild index, sharing the in-flight guard across lazy and manual paths. */
function runMemoryReindex(): Promise<ReindexResult> {
  if (!memoryReindexInFlight) {
    memoryReindexInFlight = reindexMemory().finally(() => {
      memoryReindexInFlight = null;
    });
  }
  return memoryReindexInFlight;
}

/** Rebuild index when it has never been fully built (lazy boot). Soft-fails. */
async function ensureMemoryIndex(): Promise<void> {
  const status = await memoryIndexStatus();
  if (status.dbIndexed) return;
  const result = await runMemoryReindex();
  if (!result.ok && result.error) {
    console.warn("memory reindex soft-fail:", result.error);
  }
}


function parseMemoryTypes(raw: unknown): MemoryType[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const types = raw.filter(
    (t): t is MemoryType => t === "interaction" || t === "dismissal",
  );
  return types.length ? [...new Set(types)] : undefined;
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };
  res.writeHead(status, headers);
  res.end(json);
}

function sendCreditsExhausted(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const ctx = getRequestContext();
  const exhausted = creditsExhaustedResponse({
    userId: ctx?.userId,
    tenantId: ctx?.tenantId ?? getRequestTenantId(),
    email: getSessionUser(req)?.email,
  });
  if (!exhausted) return false;
  send(req, res, 402, exhausted);
  return true;
}

class BodyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_SIZE = 1_048_576;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_SIZE) {
        reject(new BodyError("Request body exceeds 1 MB limit", 413));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch {
        reject(new BodyError("Invalid JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "OPTIONS") {
      return send(req, res, 204, {});
    }

    if (await tryHandleAuth(req, res, url)) {
      return;
    }

    if (await tryHandleStripeWebhook(req, res, url)) {
      return;
    }

    if (authRequired() && !isPublicApiPath(url.pathname)) {
      if (
        !isOriginAllowed(
          typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        )
      ) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
      if (!getSessionUser(req)) {
        return send(req, res, 401, {
          error: "unauthenticated",
          message: "Sign in required",
        });
      }
      // State-changing requests with a session must come from an allowed origin;
      // otherwise a cross-site fetch would ride the same-site-session cookie.
      if (req.method === "POST" && !isOriginAllowed(requestOrigin(req))) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
    }

    const sessionUser = getSessionUser(req);
    const tenantId = sessionUser
      ? ensureUserTenant(sessionUser.id)
      : getLocalTenantId();
    enterRequestContext({ tenantId, userId: sessionUser?.id });

    if (await tryHandleBilling(req, res, url)) {
      return;
    }

    if (await tryHandleAdmin(req, res, url)) {
      return;
    }

    if (await tryHandleOnboarding(req, res, url)) {
      return;
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/api/health" || url.pathname === "/health")
    ) {
      const session = getSessionFromEnv();
      const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
      const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
      const memory = await memoryIndexStatus();
      return send(req, res, 200, {
        ok: true,
        sessionConfigured: session.configured,
        deepseekConfigured: hasDeepseek,
        geminiConfigured: hasGemini,
        memoryIndex: {
          dbExists: memory.dbExists,
          modelCached: memory.modelCached,
          modelError: memory.modelError,
        },
      });
    }

    if (req.method === "POST" && url.pathname === "/api/memory/search") {
      if (!isLocalOrigin(typeof req.headers.origin === "string" ? req.headers.origin : undefined)) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const query = typeof body.query === "string" ? body.query.trim() : "";
      if (!query) {
        return send(req, res, 400, {
          error: "bad_request",
          message: 'Pass { query: string, k?: number, types?: ("interaction"|"dismissal")[] }.',
        });
      }
      const k =
        typeof body.k === "number" && Number.isFinite(body.k)
          ? Math.max(1, Math.min(20, Math.round(body.k)))
          : undefined;
      const types = parseMemoryTypes(body.types);
      await ensureMemoryIndex();
      const result = await searchMemory({ query, k, types });
      if (result.error) {
        return send(req, res, 503, {
          ok: false,
          error: "memory_unavailable",
          message: result.error,
          hits: result.hits,
        });
      }
      return send(req, res, 200, { ok: true, hits: result.hits });
    }

    if (req.method === "POST" && url.pathname === "/api/memory/reindex") {
      if (!isLocalOrigin(typeof req.headers.origin === "string" ? req.headers.origin : undefined)) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
      const result = await runMemoryReindex();
      if (!result.ok) {
        return send(req, res, 503, {
          error: "reindex_failed",
          message: result.error ?? "Failed to reindex memory",
          indexed: result.indexed,
          skipped: result.skipped,
        });
      }
      return send(req, res, 200, {
        ok: true,
        indexed: result.indexed,
        skipped: result.skipped,
      });
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/api/session/verify" || url.pathname === "/api/session")
    ) {
      const result = await verifySession();
      return send(req, res, result.ok ? 200 : result.status || 401, result);
    }

    if (req.method === "GET" && url.pathname === "/api/usage") {
      const windowRaw = (url.searchParams.get("window") || "7d").toLowerCase();
      const window =
        windowRaw === "24h" || windowRaw === "all" || windowRaw === "7d"
          ? windowRaw
          : "7d";
      try {
        const summary = getUsageSummary({ window });
        return send(req, res, 200, { ok: true, ...summary });
      } catch (err) {
        return send(req, res, 500, {
          error: "usage_unavailable",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/search") {
      let body: { queries?: unknown; agenda?: unknown; filters?: unknown };
      try {
        body = (await readBody(req)) as {
          queries?: unknown;
          agenda?: unknown;
          filters?: unknown;
        };
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";
      const queries = Array.isArray(body.queries)
        ? body.queries.filter((q): q is string => typeof q === "string")
        : [];
      const filters = parseScoutFilters(body.filters);
      if (sendCreditsExhausted(req, res)) return;
      const gate = tryBeginScout();
      if (!gate.ok) {
        return send(req, res, gate.status, {
          error: gate.error,
          message: gate.message,
        });
      }
      try {
        await ensureMemoryIndex();
        const result = await runScoutSearch({ agenda, queries, filters });
        if (!result.ok) {
          return send(req, res, result.status, {
            error: result.error,
            message: result.message,
          });
        }
        const done = result.event;
        return send(req, res, 200, {
          queries: done.queries,
          threads: done.threads,
          errors: done.errors,
          plannedBy: done.plannedBy,
          model: done.model,
          triageModel: done.triageModel,
          triageWarning: done.triageWarning,
          cooldownFiltered: done.cooldownFiltered,
          cooldownAuthors: done.cooldownAuthors,
          cooldownWarning: done.cooldownWarning,
          linkFiltered: done.linkFiltered,
          linkWarning: done.linkWarning,
          lengthFiltered: done.lengthFiltered,
          lengthWarning: done.lengthWarning,
          pipelineCounts: done.pipelineCounts,
        });
      } finally {
        endScout();
      }
    }

    if (req.method === "POST" && url.pathname === "/api/scout/run") {
      let body: {
        queries?: unknown;
        agenda?: unknown;
        filters?: unknown;
        targetCool?: unknown;
        bucketSize?: unknown;
      };
      try {
        body = (await readBody(req)) as {
          queries?: unknown;
          agenda?: unknown;
          filters?: unknown;
          targetCool?: unknown;
          bucketSize?: unknown;
        };
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";
      const queries = Array.isArray(body.queries)
        ? body.queries.filter((q): q is string => typeof q === "string")
        : [];
      const filters = parseScoutFilters(body.filters);
      const targetCool = clampTargetCool(body.targetCool);
      const bucketSize = clampBucketSize(body.bucketSize);

      if (sendCreditsExhausted(req, res)) return;

      const gate = tryBeginScout();
      if (!gate.ok) {
        return send(req, res, gate.status, {
          error: gate.error,
          message: gate.message,
        });
      }

      const abort = new AbortController();
      const onClose = () => {
        if (!res.writableEnded) abort.abort();
      };
      req.on("close", onClose);

      try {
        res.writeHead(200, {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          ...corsHeaders(req),
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let sawTerminal = false;
        const writeLine = (event: { stage?: string; [key: string]: unknown }) => {
          if (event.stage === "done" || event.stage === "error") {
            sawTerminal = true;
          }
          res.write(`${JSON.stringify(event)}\n`);
          // Push each NDJSON line through proxies (Vite) promptly.
          const flushable = res as typeof res & { flush?: () => void };
          flushable.flush?.();
        };

        await ensureMemoryIndex();
        const requestCtx = getRequestContext();
        const result = await runScoutCollect({
          agenda,
          queries,
          filters,
          targetCool,
          bucketSize,
          signal: abort.signal,
          onEvent: writeLine,
          deps: {
            // Re-check the ceiling as reads accrue so a run cannot overspend
            // the remaining monthly pool once it empties mid-flight.
            creditGate: async () =>
              creditsExhaustedResponse({
                userId: requestCtx?.userId,
                tenantId: requestCtx?.tenantId ?? getRequestTenantId(),
                email: getSessionUser(req)?.email,
              }) === null,
          },
        });
        if (!result.ok && !sawTerminal) {
          writeLine({
            agent: "scout",
            stage: "error",
            message: `Scout failed: ${result.message}`,
            detail: { error: result.error, status: result.status },
            at: new Date().toISOString(),
          });
        }
        return res.end();
      } finally {
        req.off("close", onClose);
        endScout();
      }
    }

    if (req.method === "GET" && url.pathname === "/api/scout/last") {
      try {
        await runExpirePass();
      } catch (err) {
        console.error("lazy expire on scout/last failed:", err);
      }
      const snapshot = await getLastScout();
      if (!snapshot) {
        return send(req, res, 200, { ok: true, empty: true });
      }
      const dedupeParam = url.searchParams.get("dedupeAccounts");
      const cooled = await getAuthorKeysForScoutFilter(
        dedupeParam !== null ? { dedupeAccounts: dedupeParam !== "false" } : undefined,
      );
      const blockedConversations = await getBlockedConversationIds();
      const filtered = filterThreadsByCooldown(
        snapshot.threads,
        cooled,
        blockedConversations,
      );
      const [expiredIds, dismissedIds, skippedIds] = await Promise.all([
        getExpiredThreadIds(),
        getDismissedThreadIds(),
        getSkippedThreadIds(),
      ]);
      const threads = filtered.threads.filter(
        (t) =>
          !expiredIds.has(t.id) &&
          !dismissedIds.has(t.id) &&
          !skippedIds.has(t.id),
      );
      return send(req, res, 200, {
        ok: true,
        empty: false,
        snapshot: {
          savedAt: snapshot.savedAt,
          agenda: snapshot.agenda,
          queries: snapshot.queries,
          threads,
          message: snapshot.message,
          pipelineCounts: snapshot.pipelineCounts,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/expired") {
      const expired = await listExpiredHistory();
      return send(req, res, 200, {
        expired,
        expiredIds: expired.map((e) => e.threadId),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/scout/log") {
      const entries = await getScoutLog();
      return send(req, res, 200, { ok: true, entries });
    }

    if (req.method === "POST" && url.pathname === "/api/scout/log") {
      let body: { message?: unknown; stage?: unknown; at?: unknown };
      try {
        body = (await readBody(req)) as {
          message?: unknown;
          stage?: unknown;
          at?: unknown;
        };
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const message = typeof body.message === "string" ? body.message : "";
      if (!message.trim()) {
        return send(req, res, 400, {
          error: "bad_request",
          message: "Pass { message: string }.",
        });
      }
      try {
        const entry = await appendScoutLog({
          message,
          stage: typeof body.stage === "string" ? body.stage : undefined,
          at: typeof body.at === "string" ? body.at : undefined,
        });
        return send(req, res, 200, { ok: true, entry });
      } catch (err) {
        return send(req, res, 500, {
          error: "store_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/interacted/stats") {
      const bucket = parseActivityBucket(url.searchParams.get("bucket"));
      // Read the durable retain (not the 200-row feed cap) so 28d/12w bucketing
      // sees in-window marks before any secondary trim.
      const history = await listInteractionHistory({
        limit: MAX_INTERACTION_STORE,
      });
      return send(req, res, 200, bucketInteractions(history, { bucket }));
    }

    if (req.method === "GET" && url.pathname === "/api/gamification") {
      try {
        return send(req, res, 200, await getGamification());
      } catch (err) {
        console.error("gamification read failed:", err);
        return send(req, res, 500, {
          error: "store_failed",
          message: "Failed to load gamification",
        });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/interacted") {
      const [interactions, active] = await Promise.all([
        listInteractionHistory(),
        listActiveInteractions(),
      ]);
      return send(req, res, 200, {
        interactions,
        activeIds: active.map((i) => i.threadId),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/dismissed") {
      const dismissals = await listDismissalHistory();
      return send(req, res, 200, {
        dismissals: dismissals.map(({ authorKey, ...rest }) => rest),
        dismissedIds: dismissals.map((d) => d.threadId),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/skipped") {
      const skipped = await listSkipHistory();
      return send(req, res, 200, {
        skipped: skipped.map(({ authorKey, ...rest }) => rest),
        skippedIds: skipped.map((d) => d.threadId),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/skipped") {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const threadId =
        typeof body.threadId === "string" ? body.threadId.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      if (!threadId || !author || !normalizeAuthorKey(author)) {
        return send(req, res, 400, {
          error: "bad_request",
          message: "Pass { threadId: string, author: string }.",
        });
      }
      try {
        const urlField = typeof body.url === "string" ? body.url : undefined;
        const text = typeof body.text === "string" ? body.text : undefined;
        const summary =
          typeof body.summary === "string" ? body.summary : undefined;
        const skip = await markSkipped({
          threadId,
          author,
          url: urlField,
          text,
          summary,
        });
        const { authorKey: _authorKey, ...skipRest } = skip;
        return send(req, res, 200, {
          ok: true,
          skip: skipRest,
        });
      } catch (err) {
        console.error("Failed to store skip:", err);
        return send(req, res, 500, {
          error: "store_failed",
          message: "Failed to store skip",
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/dismissed") {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const threadId =
        typeof body.threadId === "string" ? body.threadId.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      if (!threadId || !author || !normalizeAuthorKey(author)) {
        return send(req, res, 400, {
          error: "bad_request",
          message: "Pass { threadId: string, author: string }.",
        });
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
          url: urlField,
          text,
          summary,
          reason,
          conversationId,
          inReplyToId,
          nowMs,
        });
        return send(req, res, 200, {
          ok: true,
          dismissal,
          memoryPath: memory.path,
        });
      } catch (err) {
        console.error("Failed to store dismissal:", err);
        return send(req, res, 500, {
          error: "store_failed",
          message: "Failed to store dismissal",
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/interacted/detect") {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const threadId =
        typeof body.threadId === "string" ? body.threadId.trim() : "";
      if (!threadId) {
        return send(req, res, 400, {
          error: "bad_request",
          message: "Pass { threadId: string }.",
        });
      }
      const conversationId =
        typeof body.conversationId === "string"
          ? body.conversationId.trim()
          : undefined;
      const session = await verifySession();
      if (!session.ok) {
        return send(req, res, session.status || 401, {
          error: session.error,
          message: session.message || "Session unavailable",
        });
      }
      const appUser = getSessionUser(req);
      const screenName = resolveDetectScreenName(
        appUser?.xUsername,
        session.user.screen_name,
      );
      if (!screenName) {
        return send(req, res, 503, {
          error: "identity_unresolved",
          message:
            "Set your X username in setup so Mark detect can find your replies.",
        });
      }
      if (sendCreditsExhausted(req, res)) return;
      /** Client-owned polling sends once:true; omit/false keeps server backoff. */
      const once = body.once === true;
      const ac = new AbortController();
      const onClose = () => ac.abort();
      req.once("close", onClose);
      try {
        const detected = once
          ? await detectOwnReplyToThread({
              threadId,
              conversationId,
              screenName,
              signal: ac.signal,
            })
          : await detectOwnReplyToThreadWithRetry({
              threadId,
              conversationId,
              screenName,
              signal: ac.signal,
            });
        if (detected.reply) {
          return send(req, res, 200, {
            ok: true,
            found: true,
            reply: detected.reply,
          });
        }
        return send(req, res, 200, {
          ok: true,
          found: false,
          reason: detected.reason,
        });
      } finally {
        req.off("close", onClose);
      }
    }

    if (req.method === "POST" && url.pathname === "/api/interacted") {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(req, res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      const replyUrl =
        typeof body.replyUrl === "string" ? body.replyUrl.trim() : "";
      const reply = normalizeReply(body.reply);
      const replyId = parseStatusIdFromUrl(replyUrl);
      if (!threadId || !author || !normalizeAuthorKey(author) || !replyId) {
        return send(req, res, 400, {
          error: "bad_request",
          message:
            "Pass { threadId: string, author: string, replyUrl: string } with a valid x.com/twitter.com status URL.",
        });
      }
      const source = "manual";
      const flags = Array.isArray(body.flags)
        ? body.flags.filter((f): f is string => typeof f === "string")
        : undefined;
      const baitScore =
        typeof body.baitScore === "number"
          ? body.baitScore
          : typeof body.score === "number"
            ? body.score
            : undefined;
      try {
        const url = typeof body.url === "string" ? body.url : undefined;
        const text = typeof body.text === "string" ? body.text : undefined;
        const summary =
          typeof body.summary === "string" ? body.summary : undefined;
        const opAuthor =
          typeof body.opAuthor === "string" ? body.opAuthor : undefined;
        const opText =
          typeof body.opText === "string" ? body.opText : undefined;
        const conversationId =
          typeof body.conversationId === "string"
            ? body.conversationId
            : undefined;
        const inReplyToId =
          typeof body.inReplyToId === "string" ? body.inReplyToId : undefined;
        const interaction = await markInteracted({
          threadId,
          author,
          source,
          url,
          text,
          summary,
          replyId,
          replyUrl,
          conversationId,
          inReplyToId,
        });
        let gamification;
        try {
          gamification = await recordMarkGamification({
            threadId,
            nowMs: Date.parse(interaction.at) || Date.now(),
          });
        } catch (err) {
          // A successful re-mark of the same thread does not retroactively
          // credit an older soft-failed mark; keep the pending projection so
          // the stats-worker retry replays this exact mark's `at`.
          console.warn("gamification mark soft-fail:", err);
          await setGamificationSyncFailed({
            threadId,
            checkpoint: "mark",
            failed: true,
            pendingAt: interaction.at,
          }).catch(() => {});
        }
        let memoryPath: string | undefined;
        if (reply) {
          const memory = await writeInteractionMemory({
            threadId,
            author,
            reply,
            source,
            url,
            text,
            summary,
            opAuthor,
            opText,
            agenda: typeof body.agenda === "string" ? body.agenda : undefined,
            baitScore,
            engage: typeof body.engage === "string" ? body.engage : undefined,
            flags,
            intent: typeof body.intent === "string" ? body.intent : undefined,
            reason: typeof body.reason === "string" ? body.reason : undefined,
            // Match durable store timestamp so later stats ticks can rediscover the note.
            interactedAt: interaction.at,
          });
          memoryPath = memory.path;
          scheduleMemoryUpsert(memory.path, "interaction");
        }
        return send(req, res, 200, {
          ok: true,
          interaction,
          memoryPath,
          ...(gamification ? { gamification } : {}),
        });
      } catch (err) {
        console.error("Failed to store interaction:", err);
        return send(req, res, 500, {
          error: "store_failed",
          message: "Failed to store interaction",
        });
      }
    }

    send(req, res, 404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    send(req, res, 500, {
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, bindHost(), () => {
  const session = getSessionFromEnv();
  const host = bindHost();
  console.log(`x-copilot sidecar on http://${host}:${PORT}`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(
      "Public bind — put TLS in front (Cloudflare proxy). See docs/PUBLIC_DEPLOY.md",
    );
  }
  console.log(
    session.configured
      ? "X API: bearer configured (run npm run test:session to verify)"
      : "X API: missing — set X_API_BEARER_TOKEN in .env",
  );
});
