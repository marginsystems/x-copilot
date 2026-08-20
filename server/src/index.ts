/**
 * Local sidecar — holds X API bearer + LLM keys off the browser.
 */
import http from "node:http";
import { resolve } from "node:path";
import {
  filterThreadsByCooldown,
  getAuthorKeysForScoutFilter,
} from "./interactionStore.js";
import {
  getBlockedConversationIds,
  getDismissedThreadIds,
} from "./dismissalStore.js";
import { runExpirePass } from "./expirePass.js";
import { getExpiredThreadIds } from "./expiredStore.js";
import { getSkippedThreadIds } from "./skipStore.js";
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
import { getPlatformDb, getLocalTenantId } from "./db.js";
import { getXApiCredsFromEnv } from "./xApi.js";
import { tryHandleAuth } from "./authHttp.js";
import { tryHandleOnboarding } from "./onboardingHttp.js";
import { corsHeaders, isOriginAllowed, requestOrigin } from "./cors.js";
import { authRequired, bindHost, isPublicApiPath } from "./authGuard.js";
import { getSessionUser } from "./sessionCookie.js";
import { tryHandleAdmin } from "./adminHttp.js";
import {
  creditsExhaustedResponse,
  ensureUserTenant,
} from "./billingStore.js";
import { trackAnalytics } from "./analyticsClient.js";
import { recordSortie } from "./scoutSorties.js";
import { getRequestContext, getRequestTenantId, runWithRequestContext } from "./requestContext.js";
import {
  tryHandleBilling,
  tryHandleStripeWebhook,
} from "./stripeHttp.js";
import {
  tryHandleXActivityAuthed,
  tryHandleXActivityWebhook,
} from "./xActivityHttp.js";
import { tryHandleVoice } from "./voiceHttp.js";
import { tryHandleForYou } from "./forYouHttp.js";
import { tryHandleMemory } from "./memoryHttp.js";
import { tryHandleUsage } from "./usageHttp.js";
import { tryHandleHistory } from "./historyHttp.js";
import { tryHandleInteracted } from "./interactedHttp.js";
import { resumeDueSubscriptions } from "./xActivitySubscribe.js";
import { BodyError, readBody, send } from "./httpJson.js";
import {
  sendCreditsExhausted,
  sendSortiesExhausted,
  sendXLinkRequired,
} from "./httpGates.js";
import { ensureMemoryIndex } from "./memoryReindex.js";

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
  return Object.keys(filters).length ? filters : undefined;
}

if (
  !loadEnv(resolve(process.cwd(), ".env"), {
    override: true,
    protected: ["NODE_ENV", "PORT"],
  })
) {
  console.error(
    "[api] .env not found — X_API_BEARER_TOKEN / DEEPSEEK_API_KEY required",
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT || 8787);

try {
  getPlatformDb();
} catch (err) {
  console.error(
    "[db] platform migrate failed:",
    err instanceof Error ? err.message : String(err),
  );
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

    if (await tryHandleXActivityWebhook(req, res, url)) {
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
    return runWithRequestContext(
      { tenantId, userId: sessionUser?.id },
      async () => {

      if (await tryHandleBilling(req, res, url)) {
        return;
      }
      if (await tryHandleXActivityAuthed(req, res, url)) {
        return;
      }

      if (await tryHandleAdmin(req, res, url)) {
        return;
      }

      if (await tryHandleOnboarding(req, res, url)) {
        return;
      }

      if (await tryHandleVoice(req, res, url)) {
        return;
      }
      if (await tryHandleForYou(req, res, url)) {
        return;
      }
      if (await tryHandleMemory(req, res, url)) {
        return;
      }
      if (await tryHandleUsage(req, res, url)) {
        return;
      }
      if (await tryHandleHistory(req, res, url)) {
        return;
      }
      if (await tryHandleInteracted(req, res, url)) {
        return;
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
        if (sendXLinkRequired(req, res)) return;
        if (sendCreditsExhausted(req, res)) return;
        if (sendSortiesExhausted(req, res)) return;
        const gate = tryBeginScout();
        if (!gate.ok) {
          return send(req, res, gate.status, {
            error: gate.error,
            message: gate.message,
          });
        }
        try {
          await ensureMemoryIndex();
          recordSortie();
          trackAnalytics({
            name: "scout.takeoff",
            userId: sessionUser?.id,
            email: sessionUser?.email,
            handle: sessionUser?.xUsername,
            detail: `${queries.length} queries`,
          });
          const result = await runScoutSearch({ agenda, queries, filters });
          if (!result.ok) {
            trackAnalytics({
              name: "scout.failed",
              userId: sessionUser?.id,
              email: sessionUser?.email,
              handle: sessionUser?.xUsername,
              detail: result.message,
              ok: false,
            });
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

        if (sendXLinkRequired(req, res)) return;
        if (sendCreditsExhausted(req, res)) return;
        if (sendSortiesExhausted(req, res)) return;

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
          recordSortie();
          trackAnalytics({
            name: "scout.takeoff",
            userId: sessionUser?.id,
            email: sessionUser?.email,
            handle: sessionUser?.xUsername,
            detail: `${queries.length} queries`,
          });
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

      send(req, res, 404, { error: "not_found" });
      },
    );
  } catch (err) {
    console.error(err);
    send(req, res, 500, {
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, bindHost(), () => {
  const xApi = getXApiCredsFromEnv();
  const host = bindHost();
  console.log(`x-copilot sidecar on http://${host}:${PORT}`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(
      "Public bind — put TLS in front (Cloudflare proxy). See docs/PUBLIC_DEPLOY.md",
    );
  }
  console.log(
    xApi.configured
      ? "X API: bearer configured (run npm run test:x-api to verify)"
      : "X API: missing — set X_API_BEARER_TOKEN in .env",
  );
  void resumeDueSubscriptions().catch((err) => {
    console.warn("[xaa] resume subscriptions", err);
  });
});
