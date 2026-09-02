/**
 * Scout search / NDJSON run / last-snapshot / scout log routes.
 *
 * The NDJSON stream on POST /api/scout/run holds the scout lock and the
 * credit / sortie / X-link gates; keep the streaming contract intact.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { trackAnalytics } from "./analyticsClient.js";
import { creditsExhaustedResponse } from "./billingQuotas.js";
import { corsHeaders } from "./cors.js";
import {
  getBlockedConversationIds,
  getDismissedThreadIds,
} from "./dismissalStore.js";
import { runExpirePass } from "./expirePass.js";
import { getExpiredThreadIds } from "./expiredStore.js";
import {
  sendCreditsExhausted,
  sendSortiesExhausted,
  sendXLinkRequired,
} from "./httpGates.js";
import { BodyError, readBody, send } from "./httpJson.js";
import {
  getAuthorKeysForScoutFilter,
} from "./interactionStore.js";
import { filterThreadsByCooldown } from "./interactionCooldown.js";
import { ensureMemoryIndex } from "./memoryReindex.js";
import {
  getRequestContext,
  getRequestTenantId,
} from "./requestContext.js";
import { getLastScout } from "./scoutCache.js";
import { preferRootTargets } from "./scoutTarget.js";
import { runScoutCollect } from "./scoutCollect.js";
import { endScout, tryBeginScout } from "./scoutGate.js";
import { appendScoutLog, getScoutLog } from "./scoutLog.js";
import {
  clampBucketSize,
  clampTargetCool,
  isCoolThread,
} from "./scoutPolicy.js";
import { runScoutSearch } from "./scoutRun.js";
import type { ScoutFilters } from "./scoutTypes.js";
import { normalizeAvoidPrompt } from "./threadFilters.js";
import {
  markSortieDelivered,
  recordSortie,
  refundSortie,
  sortieWasWasted,
} from "./scoutSorties.js";
import { getSessionUser } from "./sessionCookie.js";
import { getSkippedThreadIds } from "./skipStore.js";

export function parseScoutFilters(raw: unknown): ScoutFilters | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const obj = raw as Record<string, unknown>;
  const filters: ScoutFilters = {};
  if (typeof obj.maxThreadChars === "number" && Number.isInteger(obj.maxThreadChars)) {
    filters.maxThreadChars = obj.maxThreadChars;
  }
  if (typeof obj.dropArticles === "boolean") {
    filters.dropArticles = obj.dropArticles;
  }
  if (typeof obj.dropOutboundLinks === "boolean") {
    filters.dropOutboundLinks = obj.dropOutboundLinks;
  }
  if (typeof obj.dropEmDashes === "boolean") {
    filters.dropEmDashes = obj.dropEmDashes;
  }
  if (typeof obj.dropProfanity === "boolean") {
    filters.dropProfanity = obj.dropProfanity;
  }
  if (typeof obj.dropAutomatedAccounts === "boolean") {
    filters.dropAutomatedAccounts = obj.dropAutomatedAccounts;
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
  if (Array.isArray(obj.excludedAccounts)) {
    filters.excludedAccounts = obj.excludedAccounts
      .filter((t): t is string => typeof t === "string")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  if (typeof obj.avoidPrompt === "string") {
    const avoidPrompt = normalizeAvoidPrompt(obj.avoidPrompt);
    if (avoidPrompt) filters.avoidPrompt = avoidPrompt;
  }
  return Object.keys(filters).length ? filters : undefined;
}

/** Test seam: stub the collect loop / memory index without touching the network. */
export type ScoutHttpDeps = {
  runScoutCollect?: typeof runScoutCollect;
  runScoutSearch?: typeof runScoutSearch;
  ensureMemoryIndex?: typeof ensureMemoryIndex;
};

export async function readLastScoutPayload(opts?: {
  dedupeAccounts?: boolean | null;
}): Promise<{
  ok: true;
  empty: boolean;
  snapshot?: {
    savedAt: string;
    agenda?: string;
    queries?: string[];
    threads: unknown[];
    message?: string;
    pipelineCounts?: unknown;
  };
}> {
  try {
    await runExpirePass();
  } catch (err) {
    console.error("lazy expire on scout/last failed:", err);
  }
  const snapshot = await getLastScout();
  if (!snapshot) return { ok: true, empty: true };
  const cooled = await getAuthorKeysForScoutFilter(
    opts?.dedupeAccounts === null || opts?.dedupeAccounts === undefined
      ? undefined
      : { dedupeAccounts: opts.dedupeAccounts },
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
  const threads = preferRootTargets(
    filtered.threads.filter(
      (t) =>
        !expiredIds.has(t.id) &&
        !dismissedIds.has(t.id) &&
        !skippedIds.has(t.id),
    ),
  );
  if (threads.length === 0) return { ok: true, empty: true };
  return {
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
  };
}

export async function tryHandleScout(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ScoutHttpDeps = {},
): Promise<boolean> {
  const doScoutCollect = deps.runScoutCollect ?? runScoutCollect;
  const doScoutSearch = deps.runScoutSearch ?? runScoutSearch;
  const doEnsureMemoryIndex = deps.ensureMemoryIndex ?? ensureMemoryIndex;

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
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";
    const queries = Array.isArray(body.queries)
      ? body.queries.filter((q): q is string => typeof q === "string")
      : [];
    const filters = parseScoutFilters(body.filters);
    if (sendXLinkRequired(req, res)) return true;
    if (sendCreditsExhausted(req, res)) return true;
    if (sendSortiesExhausted(req, res)) return true;
    const gate = tryBeginScout();
    if (!gate.ok) {
      send(req, res, gate.status, {
        error: gate.error,
        message: gate.message,
      });
      return true;
    }
    const sessionUser = getSessionUser(req);
    let sortieId: string | undefined;
    let coolCount = 0;
    try {
      await doEnsureMemoryIndex();
      sortieId = recordSortie();
      trackAnalytics({
        name: "scout.takeoff",
        userId: sessionUser?.id,
        email: sessionUser?.email,
        handle: sessionUser?.xUsername,
        detail: `${queries.length} queries`,
      });
      const result = await doScoutSearch({ agenda, queries, filters });
      coolCount = result.ok
        ? Array.isArray(result.event.threads)
          ? result.event.threads.filter(isCoolThread).length
          : 0
        : 0;
      if (sortieWasWasted({ ok: result.ok, coolCount })) {
        refundSortie(sortieId);
      }
      if (!result.ok) {
        trackAnalytics({
          name: "scout.failed",
          userId: sessionUser?.id,
          email: sessionUser?.email,
          handle: sessionUser?.xUsername,
          detail: result.message,
          ok: false,
        });
        send(req, res, result.status, {
          error: result.error,
          message: result.message,
        });
        return true;
      }
      const done = result.event;
      send(req, res, 200, {
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
      // Mark delivered only once the response write actually landed, so a
      // torn-down socket does not complete the takeoff mission for threads
      // the client never received (mirrors the streaming writeLine reorder).
      if (coolCount >= 1) {
        markSortieDelivered(sortieId);
      }
      return true;
    } catch (err) {
      if (sortieId) {
        // The batch response never reached the client — the single 200 write
        // threw on a torn socket — so refund the sortie rather than stranding
        // it (neither delivered nor refunded).
        refundSortie(sortieId);
      }
      try {
        send(req, res, 500, {
          error: "internal_error",
          message: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // Headers already sent or socket torn down; nothing left to write.
      }
      return true;
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
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";
    const queries = Array.isArray(body.queries)
      ? body.queries.filter((q): q is string => typeof q === "string")
      : [];
    const filters = parseScoutFilters(body.filters);
    const targetCool = clampTargetCool(body.targetCool);
    const bucketSize = clampBucketSize(body.bucketSize);

    if (sendXLinkRequired(req, res)) return true;
    if (sendCreditsExhausted(req, res)) return true;
    if (sendSortiesExhausted(req, res)) return true;

    const gate = tryBeginScout();
    if (!gate.ok) {
      send(req, res, gate.status, {
        error: gate.error,
        message: gate.message,
      });
      return true;
    }

    const abort = new AbortController();
    const onClose = () => {
      if (!res.writableEnded) abort.abort();
    };
    req.on("close", onClose);

    const sessionUser = getSessionUser(req);
    let sortieId: string | undefined;
    let coolCount = 0;
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
        // Only count an event's cool threads once the write actually landed,
        // so a torn-down socket does not mark a sortie as delivered.
        if (typeof event.coolCount === "number") {
          coolCount = Math.max(coolCount, event.coolCount);
        } else if (
          event.stage === "done" &&
          Array.isArray(event.threads)
        ) {
          coolCount = Math.max(coolCount, event.threads.length);
        }
      };

      await doEnsureMemoryIndex();
      sortieId = recordSortie();
      trackAnalytics({
        name: "scout.takeoff",
        userId: sessionUser?.id,
        email: sessionUser?.email,
        handle: sessionUser?.xUsername,
        detail: `${queries.length} queries`,
      });
      const requestCtx = getRequestContext();
      const result = await doScoutCollect({
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
        trackAnalytics({
          name: "scout.failed",
          userId: sessionUser?.id,
          email: sessionUser?.email,
          handle: sessionUser?.xUsername,
          detail: result.message,
          ok: false,
        });
        writeLine({
          agent: "scout",
          stage: "error",
          message: `Scout failed: ${result.message}`,
          detail: { error: result.error, status: result.status },
          at: new Date().toISOString(),
        });
      }
      if (result.ok && typeof result.event.coolCount === "number") {
        coolCount = result.event.coolCount;
      } else if (
        result.ok &&
        Array.isArray(result.event.threads)
      ) {
        coolCount = result.event.threads.length;
      }
      if (sortieWasWasted({ ok: result.ok, coolCount })) {
        refundSortie(sortieId);
      } else {
        markSortieDelivered(sortieId);
      }
      res.end();
      return true;
    } catch (err) {
      if (sortieWasWasted({ ok: false, coolCount }) && sortieId) {
        refundSortie(sortieId);
      } else if (sortieId) {
        markSortieDelivered(sortieId);
      }
      console.error("scout run failed:", err);
      try {
        if (!res.writableEnded) {
          res.write(
            `${JSON.stringify({
              agent: "scout",
              stage: "error",
              message: err instanceof Error ? err.message : String(err),
              detail: { error: "internal_error", status: 500 },
              at: new Date().toISOString(),
            })}\n`,
          );
          res.end();
        }
      } catch {
        // Socket already torn down (client aborted); nothing left to write.
      }
      return true;
    } finally {
      req.off("close", onClose);
      endScout();
    }
  }

  if (req.method === "GET" && url.pathname === "/api/scout/last") {
    const dedupeParam = url.searchParams.get("dedupeAccounts");
    send(
      req,
      res,
      200,
      await readLastScoutPayload({
        dedupeAccounts:
          dedupeParam === null ? null : dedupeParam !== "false",
      }),
    );
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/scout/log") {
    const entries = await getScoutLog();
    send(req, res, 200, { ok: true, entries });
    return true;
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
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const message = typeof body.message === "string" ? body.message : "";
    if (!message.trim()) {
      send(req, res, 400, {
        error: "bad_request",
        message: "Pass { message: string }.",
      });
      return true;
    }
    try {
      const entry = await appendScoutLog({
        message,
        stage: typeof body.stage === "string" ? body.stage : undefined,
        at: typeof body.at === "string" ? body.at : undefined,
      });
      send(req, res, 200, { ok: true, entry });
      return true;
    } catch (err) {
      send(req, res, 500, {
        error: "store_failed",
        message: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }

  return false;
}
