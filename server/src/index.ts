/**
 * Local sidecar — holds X session cookies + DeepSeek calls off the browser.
 */
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { loadEnv } from "./loadEnv.js";
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

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolveBody({});
      try {
        resolveBody(JSON.parse(raw));
      } catch (err) {
        reject(err);
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
      const body = (await readBody(req).catch(() => ({}))) as {
        queries?: unknown;
        agenda?: unknown;
      };
      const session = getSessionFromEnv();
      if (!session.configured) {
        return send(res, 401, {
          error: "missing_credentials",
          message: "Set X_AUTH_TOKEN and X_CT0 in .env.",
        });
      }

      const queries = Array.isArray(body.queries)
        ? body.queries.filter((q): q is string => typeof q === "string")
        : [];

      if (queries.length === 0) {
        return send(res, 400, {
          error: "missing_queries",
          message:
            "PR1: pass { queries: string[] }. Agenda + DeepSeek planning lands in the next PR.",
        });
      }

      const result = await searchMany(queries, { session });
      return send(res, 200, {
        queries: result.queries,
        threads: result.threads,
        errors: result.errors,
      });
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
