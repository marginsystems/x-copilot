/**
 * Auth HTTP routes: Google OAuth, session me/logout, public X username.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { revokeSessionToken, toPublicUser } from "./authStore.js";
import { corsHeaders, isOriginAllowed, requestOrigin } from "./cors.js";
import { handleGoogleCallback, handleGoogleStart } from "./googleAuth.js";
import { handleXCallback, handleXStart } from "./xAuth.js";
import { isAdminEmail } from "./adminEmails.js";
import { ensureUserTenant } from "./billingStore.js";
import {
  AUTH_START_RATE,
  allowRate,
  authRequired,
  clientIp,
} from "./authGuard.js";
import {
  getSessionUser,
  requestCookies,
  SESSION_COOKIE,
  sessionClearCookie,
} from "./sessionCookie.js";
import { applyVerifiedXUsername } from "./xHandleVerify.js";
import { runUserIngest } from "./userIngest.js";

const X_USERNAME_RATE = { max: 20, windowMs: 10 * 60 * 1000 };

class BodyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_SIZE = 16_384;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_SIZE) {
        reject(new BodyError("Request body exceeds limit", 413));
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

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  extraCookies: string[] = [],
): void {
  const headers: Record<string, string | string[]> = {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  };
  if (extraCookies.length === 1) {
    headers["Set-Cookie"] = extraCookies[0];
  } else if (extraCookies.length > 1) {
    headers["Set-Cookie"] = extraCookies;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function publicUser(user: NonNullable<ReturnType<typeof getSessionUser>>) {
  return {
    ...toPublicUser(user),
    isAdmin: isAdminEmail(user.email),
  };
}

/** Handle /api/auth/* — returns true if the request was consumed. */
export async function tryHandleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/auth")) return false;

  if (req.method === "GET" && url.pathname === "/api/auth/google") {
    if (!allowRate(`auth:${clientIp(req)}`, AUTH_START_RATE.max, AUTH_START_RATE.windowMs)) {
      sendJson(req, res, 429, { error: "rate_limited", message: "Too many login attempts" });
      return true;
    }
    handleGoogleStart(req, res);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/google/callback") {
    await handleGoogleCallback(req, res, url);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/x") {
    if (!allowRate(`auth:${clientIp(req)}`, AUTH_START_RATE.max, AUTH_START_RATE.windowMs)) {
      sendJson(req, res, 429, { error: "rate_limited", message: "Too many login attempts" });
      return true;
    }
    await handleXStart(req, res);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/x/callback") {
    await handleXCallback(req, res, url);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const required = authRequired();
    const user = getSessionUser(req);
    if (!user) {
      sendJson(req, res, 401, { ok: false, error: "unauthenticated", authRequired: required });
      return true;
    }
    try {
      ensureUserTenant(user.id);
    } catch (err) {
      console.error("[GET /api/auth/me] tenant", err);
    }
    sendJson(req, res, 200, { ok: true, authRequired: required, user: publicUser(user) });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/x-username") {
    if (!isOriginAllowed(requestOrigin(req))) {
      sendJson(req, res, 403, {
        error: "forbidden",
        message: "Origin not allowed",
      });
      return true;
    }
    if (
      !allowRate(
        `auth-x-username:${clientIp(req)}`,
        X_USERNAME_RATE.max,
        X_USERNAME_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many username updates",
      });
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
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      sendJson(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      if (statusCode === 413) req.destroy();
      return true;
    }
    const applied = await applyVerifiedXUsername({
      user,
      raw: body.xUsername,
    });
    if (!applied.ok) {
      sendJson(req, res, applied.status, {
        ok: false,
        error: applied.error,
        message: applied.message,
      });
      return true;
    }
    if (
      applied.accountChanged &&
      allowRate(
        `onboarding-ingest:${applied.user.id}`,
        6,
        10 * 60 * 1000,
      )
    ) {
      try {
        await runUserIngest({ user: applied.user, mode: "initial" });
      } catch (err) {
        console.warn("[auth] x-username ingest soft-fail", err);
      }
    }
    sendJson(req, res, 200, {
      ok: true,
      changed: applied.changed,
      user: publicUser(applied.user),
    });
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/auth/logout") {
    const token = requestCookies(req)[SESSION_COOKIE];
    if (token) revokeSessionToken(token);
    sendJson(
      req,
      res,
      200,
      { ok: true },
      [sessionClearCookie(req)],
    );
    return true;
  }

  sendJson(req, res, 404, { error: "not_found" });
  return true;
}
