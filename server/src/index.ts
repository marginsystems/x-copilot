/**
 * Local sidecar — holds X session cookies + DeepSeek calls off the browser.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  filterThreadsByCooldown,
  getAuthorKeysForScoutFilter,
  listActiveInteractions,
  listInteractionHistory,
  markInteracted,
  parseStatusIdFromUrl,
  normalizeAuthorKey,
} from "./interactionStore.js";
import {
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
  normalizeReply,
  writeDismissalMemory,
  writeInteractionMemory,
} from "./knowledgeMemory.js";
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
import { getSessionFromEnv, verifySession } from "./xSession.js";

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
  if (typeof obj.dedupeAccounts === "boolean") {
    filters.dedupeAccounts = obj.dedupeAccounts;
  }
  return Object.keys(filters).length ? filters : undefined;
}

loadEnv(resolve(process.cwd(), ".env"));

const PORT = Number(process.env.PORT || 8787);

function send(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(json);
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
      return send(res, 204, {});
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/api/health" || url.pathname === "/health")
    ) {
      const session = getSessionFromEnv();
      const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY);
      return send(res, 200, {
        ok: true,
        sessionConfigured: session.configured,
        deepseekConfigured: hasDeepseek,
      });
    }

    if (
      req.method === "GET" &&
      (url.pathname === "/api/session/verify" || url.pathname === "/api/session")
    ) {
      const result = await verifySession();
      return send(res, result.ok ? 200 : result.status || 401, result);
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
        return send(res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";
      const queries = Array.isArray(body.queries)
        ? body.queries.filter((q): q is string => typeof q === "string")
        : [];
      const filters = parseScoutFilters(body.filters);
      const gate = tryBeginScout();
      if (!gate.ok) {
        return send(res, gate.status, {
          error: gate.error,
          message: gate.message,
        });
      }
      try {
        const result = await runScoutSearch({ agenda, queries, filters });
        if (!result.ok) {
          return send(res, result.status, {
            error: result.error,
            message: result.message,
          });
        }
        const done = result.event;
        return send(res, 200, {
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
        return send(res, statusCode, {
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

      const gate = tryBeginScout();
      if (!gate.ok) {
        return send(res, gate.status, {
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
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Content-Type",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        let sawTerminal = false;
        const writeLine = (event: { stage?: string; [key: string]: unknown }) => {
          if (event.stage === "done" || event.stage === "error") {
            sawTerminal = true;
          }
          res.write(`${JSON.stringify(event)}\n`);
        };

        const result = await runScoutCollect({
          agenda,
          queries,
          filters,
          targetCool,
          bucketSize,
          signal: abort.signal,
          onEvent: writeLine,
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
        return send(res, 200, { ok: true, empty: true });
      }
      const dedupeParam = url.searchParams.get("dedupeAccounts");
      const cooled = await getAuthorKeysForScoutFilter(
        dedupeParam !== null ? { dedupeAccounts: dedupeParam !== "false" } : undefined,
      );
      const filtered = filterThreadsByCooldown(snapshot.threads, cooled);
      const [expiredIds, dismissedIds] = await Promise.all([
        getExpiredThreadIds(),
        getDismissedThreadIds(),
      ]);
      const threads = filtered.threads.filter(
        (t) => !expiredIds.has(t.id) && !dismissedIds.has(t.id),
      );
      return send(res, 200, {
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
      return send(res, 200, {
        expired,
        expiredIds: expired.map((e) => e.threadId),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/scout/log") {
      const entries = await getScoutLog();
      return send(res, 200, { ok: true, entries });
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
        return send(res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const message = typeof body.message === "string" ? body.message : "";
      if (!message.trim()) {
        return send(res, 400, {
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
        return send(res, 200, { ok: true, entry });
      } catch (err) {
        return send(res, 500, {
          error: "store_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/interacted") {
      const [interactions, active] = await Promise.all([
        listInteractionHistory(),
        listActiveInteractions(),
      ]);
      return send(res, 200, {
        interactions,
        activeIds: active.map((i) => i.threadId),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/dismissed") {
      const dismissals = await listDismissalHistory();
      return send(res, 200, {
        dismissals: dismissals.map(({ authorKey, ...rest }) => rest),
        dismissedIds: dismissals.map((d) => d.threadId),
      });
    }

    if (req.method === "POST" && url.pathname === "/api/dismissed") {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const threadId =
        typeof body.threadId === "string" ? body.threadId.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      if (!threadId || !author || !normalizeAuthorKey(author)) {
        return send(res, 400, {
          error: "bad_request",
          message: "Pass { threadId: string, author: string }.",
        });
      }
      try {
        const urlField = typeof body.url === "string" ? body.url : undefined;
        const text = typeof body.text === "string" ? body.text : undefined;
        const summary =
          typeof body.summary === "string" ? body.summary : undefined;
        const reason =
          typeof body.reason === "string" ? body.reason : undefined;
        const nowMs = Date.now();
        const dismissedAt = new Date(nowMs).toISOString();
        const memory = await writeDismissalMemory({
          threadId,
          author,
          url: urlField,
          text,
          summary,
          reason,
          dismissedAt,
        });
        const dismissal = await markDismissed({
          threadId,
          author,
          url: urlField,
          text,
          summary,
          reason,
          nowMs,
        });
        return send(res, 200, {
          ok: true,
          dismissal,
          memoryPath: memory.path,
        });
      } catch (err) {
        console.error("Failed to store dismissal:", err);
        return send(res, 500, {
          error: "store_failed",
          message: "Failed to store dismissal",
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/interacted") {
      let body: Record<string, unknown>;
      try {
        body = (await readBody(req)) as Record<string, unknown>;
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(res, statusCode, {
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
        return send(res, 400, {
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
        const interaction = await markInteracted({
          threadId,
          author,
          source,
          url,
          text,
          summary,
          replyId,
          replyUrl,
        });
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
            agenda: typeof body.agenda === "string" ? body.agenda : undefined,
            baitScore,
            engage: typeof body.engage === "string" ? body.engage : undefined,
            flags,
            intent: typeof body.intent === "string" ? body.intent : undefined,
            reason: typeof body.reason === "string" ? body.reason : undefined,
          });
          memoryPath = memory.path;
        }
        return send(res, 200, {
          ok: true,
          interaction,
          memoryPath,
        });
      } catch (err) {
        console.error("Failed to store interaction:", err);
        return send(res, 500, {
          error: "store_failed",
          message: "Failed to store interaction",
        });
      }
    }

    send(res, 404, { error: "not_found" });
  } catch (err) {
    console.error(err);
    send(res, 500, {
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  const session = getSessionFromEnv();
  console.log(`x-copilot sidecar on http://127.0.0.1:${PORT}`);
  console.log(
    session.configured
      ? "X session: configured (run npm run test:session to verify)"
      : "X session: missing — set X_AUTH_TOKEN and X_CT0 in .env",
  );
});
