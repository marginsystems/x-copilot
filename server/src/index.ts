/**
 * Local sidecar — holds X session cookies + DeepSeek calls off the browser.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import {
  filterThreadsByCooldown,
  getCooledAuthorKeys,
  listActiveInteractions,
  markInteracted,
  normalizeAuthorKey,
} from "./interactionStore.js";
import { loadEnv } from "./loadEnv.js";
import { getLastScout } from "./scoutCache.js";
import { endScout, tryBeginScout } from "./scoutGate.js";
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
        });
      } finally {
        endScout();
      }
    }

    if (req.method === "POST" && url.pathname === "/api/scout/run") {
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

        const result = await runScoutSearch({
          agenda,
          queries,
          filters,
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
        endScout();
      }
    }

    if (req.method === "GET" && url.pathname === "/api/scout/last") {
      const snapshot = await getLastScout();
      if (!snapshot) {
        return send(res, 200, { ok: true, empty: true });
      }
      const cooled = await getCooledAuthorKeys();
      const filtered = filterThreadsByCooldown(snapshot.threads, cooled);
      return send(res, 200, {
        ok: true,
        empty: false,
        snapshot: {
          savedAt: snapshot.savedAt,
          agenda: snapshot.agenda,
          queries: snapshot.queries,
          threads: filtered.threads,
          message: snapshot.message,
        },
      });
    }

    if (req.method === "GET" && url.pathname === "/api/interacted") {
      const interactions = await listActiveInteractions();
      return send(res, 200, { interactions });
    }

    if (req.method === "POST" && url.pathname === "/api/interacted") {
      let body: { threadId?: unknown; author?: unknown; source?: unknown };
      try {
        body = (await readBody(req)) as {
          threadId?: unknown;
          author?: unknown;
          source?: unknown;
        };
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
      const author = typeof body.author === "string" ? body.author.trim() : "";
      if (!threadId || !author || !normalizeAuthorKey(author)) {
        return send(res, 400, {
          error: "bad_request",
          message: "Pass { threadId: string, author: string }.",
        });
      }
      const source = body.source === "copy" ? "copy" : "manual";
      try {
        const interaction = await markInteracted({ threadId, author, source });
        return send(res, 200, { ok: true, interaction });
      } catch (err) {
        return send(res, 500, {
          error: "store_failed",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/draft") {
      await readBody(req).catch(() => ({}));
      return send(res, 501, {
        error: "not_implemented",
        message: "Wire DeepSeek draft generation here.",
      });
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
