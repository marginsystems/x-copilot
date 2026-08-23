/**
 * Auth HTTP routes: Google / X OAuth, session me/logout.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { toPublicUser } from "./authStore.js";
import { send } from "./httpJson.js";
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
import { revokeSessionToken } from "./sessionStore.js";
import { tryHandleSessions } from "./sessionsHttp.js";

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
  extraCookies: string[] = [],
): void {
  send(
    req,
    res,
    status,
    body,
    extraCookies.length === 1
      ? { "Set-Cookie": extraCookies[0] }
      : extraCookies.length > 1
        ? { "Set-Cookie": extraCookies }
        : undefined,
  );
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
  if (await tryHandleSessions(req, res, url)) return true;

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
