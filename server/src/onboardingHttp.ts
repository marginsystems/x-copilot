/**
 * First-run onboarding HTTP: persist a chosen agenda.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  completeOnboarding,
  toPublicUser,
  userNeedsXHandle,
} from "./authStore.js";
import { corsHeaders } from "./cors.js";
import {
  generateOnboardingAgendas,
  validateAgendaText,
  validateOnboardingAnswers,
} from "./onboarding.js";
import { getSessionUser } from "./sessionCookie.js";
import { allowRate, clientIp } from "./authGuard.js";
import { parseXHandle } from "./xHandle.js";
import { lookupXUserByUsername } from "./xSession.js";

const ONBOARDING_GENERATE_RATE = { max: 20, windowMs: 10 * 60 * 1000 };
const ONBOARDING_COMPLETE_RATE = { max: 20, windowMs: 10 * 60 * 1000 };

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

class BodyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
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
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new BodyError("Invalid JSON", 400));
          return;
        }
        resolveBody(parsed as Record<string, unknown>);
      } catch {
        reject(new BodyError("Invalid JSON", 400));
      }
    });
    req.on("error", reject);
  });
}

/** Handle /api/onboarding/* — returns true if the request was consumed. */
export async function tryHandleOnboarding(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/onboarding")) return false;

  if (req.method === "POST" && url.pathname === "/api/onboarding/generate") {
    if (
      !allowRate(
        `onboarding-generate:${clientIp(req)}`,
        ONBOARDING_GENERATE_RATE.max,
        ONBOARDING_GENERATE_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many agenda generations",
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      sendJson(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }

    const parsed = validateOnboardingAnswers(body);
    if (!parsed.ok) {
      sendJson(req, res, 400, { error: parsed.error, message: parsed.message });
      return true;
    }

    const result = await generateOnboardingAgendas(parsed.answers);
    sendJson(req, res, 200, {
      ok: true,
      agendas: result.agendas,
      source: result.source,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/onboarding/complete") {
    if (
      !allowRate(
        `onboarding-complete:${clientIp(req)}`,
        ONBOARDING_COMPLETE_RATE.max,
        ONBOARDING_COMPLETE_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many setup completions",
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = await readBody(req);
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      sendJson(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      // Oversized body: the rest of the stream is still flowing. Destroy the
      // request after responding so leftover bytes are not parsed as the start
      // of a keep-alive connection's next request.
      if (statusCode === 413) req.destroy();
      return true;
    }

    const parsed = validateAgendaText(body.agenda);
    if (!parsed.ok) {
      sendJson(req, res, 400, { error: parsed.error, message: parsed.message });
      return true;
    }

    const user = getSessionUser(req);
    if (!user) {
      sendJson(req, res, 401, {
        ok: false,
        error: "unauthenticated",
        message: "Sign in required",
      });
      return true;
    }

    let xUsername: string | null = parseXHandle(user.xUsername ?? "") ?? null;
    if (userNeedsXHandle(user)) {
      const parsed = parseXHandle(body.xUsername);
      if (!parsed) {
        sendJson(req, res, 400, {
          error: "needs_x_handle",
          message: "Enter your X username so we can find your replies.",
        });
        return true;
      }
      const looked = await lookupXUserByUsername(parsed);
      if (looked.ok) {
        xUsername = looked.user.screen_name;
      } else if (looked.error === "missing_credentials") {
        sendJson(req, res, 503, {
          error: "x_api_unavailable",
          message:
            "Could not verify that X username — this server isn't connected to the X API yet. Try again later.",
        });
        return true;
      } else if (looked.error === "user_not_found" || looked.status === 404) {
        sendJson(req, res, 400, {
          error: "x_user_not_found",
          message: `No X account named @${parsed}.`,
        });
        return true;
      } else {
        sendJson(req, res, looked.status || 502, {
          error: looked.error,
          message: looked.message || "Could not verify that X username.",
        });
        return true;
      }
    }

    const updated = completeOnboarding(user.id, parsed.agenda, { xUsername });
    if (!updated) {
      sendJson(req, res, 404, {
        error: "not_found",
        message: "User not found.",
      });
      return true;
    }
    sendJson(req, res, 200, {
      ok: true,
      persisted: true,
      user: toPublicUser(updated),
    });
    void import("./xActivitySubscribe.js")
      .then(({ subscribeUserToPostCreate }) =>
        subscribeUserToPostCreate(updated.id),
      )
      .catch((err) => console.warn("[xaa] subscribe", err));
    return true;
  }

  sendJson(req, res, 404, { error: "not_found" });
  return true;
}
