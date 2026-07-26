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
} from "./interactionStore.js";
import { loadEnv } from "./loadEnv.js";
import { planQueriesFromAgenda } from "./queryPlan.js";
import { triageThreads } from "./threadTriage.js";
import { searchMany } from "./xSearch.js";
import { getSessionFromEnv, verifySession } from "./xSession.js";

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
      let body: { queries?: unknown; agenda?: unknown };
      try {
        body = (await readBody(req)) as {
          queries?: unknown;
          agenda?: unknown;
        };
      } catch (err) {
        const statusCode = err instanceof BodyError ? err.statusCode : 400;
        return send(res, statusCode, {
          error: "bad_request",
          message: err instanceof Error ? err.message : "Invalid request body",
        });
      }
      const session = getSessionFromEnv();
      if (!session.configured) {
        return send(res, 401, {
          error: "missing_credentials",
          message: "Set X_AUTH_TOKEN and X_CT0 in .env.",
        });
      }

      let queries = Array.isArray(body.queries)
        ? body.queries.filter((q): q is string => typeof q === "string")
        : [];
      let plannedBy: "client" | "deepseek" = "client";
      let planModel: string | undefined;
      const agenda = typeof body.agenda === "string" ? body.agenda.trim() : "";

      if (queries.length === 0) {
        if (!agenda) {
          return send(res, 400, {
            error: "missing_agenda",
            message: "Pass { agenda: string } or { queries: string[] }.",
          });
        }
        if (!process.env.DEEPSEEK_API_KEY?.trim()) {
          return send(res, 503, {
            error: "missing_deepseek_key",
            message: "Set DEEPSEEK_API_KEY for agenda → query planning.",
          });
        }
        const plan = await planQueriesFromAgenda(agenda);
        if (!plan.ok) {
          return send(res, 502, {
            error: plan.error,
            message: plan.message,
          });
        }
        queries = plan.queries;
        plannedBy = "deepseek";
        planModel = plan.model;
      }

      const result = await searchMany(queries, { session });
      const cooled = await getCooledAuthorKeys();
      const filtered = filterThreadsByCooldown(result.threads, cooled);
      const triaged = await triageThreads({
        agenda,
        threads: filtered.threads,
      });
      return send(res, 200, {
        queries: result.queries,
        threads: triaged.threads,
        errors: result.errors,
        plannedBy,
        model: planModel,
        triageModel: triaged.model,
        triageWarning: triaged.warning,
        cooldownFiltered: filtered.filteredCount,
        cooldownAuthors: filtered.filteredAuthors,
        cooldownWarning: filtered.filteredCount
          ? `Filtered ${filtered.filteredCount} posts from cooled-down authors.`
          : undefined,
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
      if (!threadId || !author) {
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
