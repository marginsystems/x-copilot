/**
 * Account + session list / revoke. UUIDs only; never the cookie or token hash.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAdminEmail } from "./adminEmails.js";
import {
  listOauthProviders,
  listSessionsForUser,
  revokeOtherSessions,
  revokeSessionById,
  toPublicUser,
} from "./authStore.js";
import { allowRate } from "./authGuard.js";
import { corsHeaders, isOriginAllowed, requestOrigin } from "./cors.js";
import { getRequestSession, sessionClearCookie } from "./sessionCookie.js";
import { toPublicSession } from "./sessionView.js";

const SESSIONS_LIST_RATE = { max: 60, windowMs: 5 * 60 * 1000 };
const SESSIONS_REVOKE_RATE = { max: 10, windowMs: 5 * 60 * 1000 };
const SESSION_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

function requireOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  if (isOriginAllowed(requestOrigin(req))) return true;
  sendJson(req, res, 403, {
    error: "forbidden",
    message: "Origin not allowed",
  });
  return false;
}

function publicSessions(userId: string, currentSessionId: string) {
  return listSessionsForUser(userId).map((row) =>
    toPublicSession(row, currentSessionId),
  );
}

/** Handle /api/auth/account and /api/auth/sessions* — true if consumed. */
export async function tryHandleSessions(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/auth/account") {
    const session = getRequestSession(req);
    if (!session) {
      sendJson(req, res, 401, { ok: false, error: "unauthenticated" });
      return true;
    }
    if (
      !allowRate(
        `sessions-list:${session.user.id}`,
        SESSIONS_LIST_RATE.max,
        SESSIONS_LIST_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many session lookups",
      });
      return true;
    }
    sendJson(req, res, 200, {
      ok: true,
      user: {
        ...toPublicUser(session.user),
        isAdmin: isAdminEmail(session.user.email),
      },
      providers: listOauthProviders(session.user.id),
      sessions: publicSessions(session.user.id, session.sessionId),
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/auth/sessions") {
    const session = getRequestSession(req);
    if (!session) {
      sendJson(req, res, 401, { ok: false, error: "unauthenticated" });
      return true;
    }
    if (
      !allowRate(
        `sessions-list:${session.user.id}`,
        SESSIONS_LIST_RATE.max,
        SESSIONS_LIST_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many session lookups",
      });
      return true;
    }
    sendJson(req, res, 200, {
      ok: true,
      sessions: publicSessions(session.user.id, session.sessionId),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/auth/sessions/revoke-others") {
    if (!requireOrigin(req, res)) return true;
    const session = getRequestSession(req);
    if (!session) {
      sendJson(req, res, 401, { ok: false, error: "unauthenticated" });
      return true;
    }
    if (
      !allowRate(
        `sessions-revoke:${session.user.id}`,
        SESSIONS_REVOKE_RATE.max,
        SESSIONS_REVOKE_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many session revokes",
      });
      return true;
    }
    const revoked = revokeOtherSessions(session.user.id, session.sessionId);
    sendJson(req, res, 200, {
      ok: true,
      revoked,
      sessions: publicSessions(session.user.id, session.sessionId),
    });
    return true;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/auth/sessions/")) {
    if (!requireOrigin(req, res)) return true;
    const id = url.pathname.slice("/api/auth/sessions/".length);
    if (!SESSION_ID_RE.test(id) || id.includes("/")) {
      sendJson(req, res, 404, { error: "not_found" });
      return true;
    }
    const session = getRequestSession(req);
    if (!session) {
      sendJson(req, res, 401, { ok: false, error: "unauthenticated" });
      return true;
    }
    if (
      !allowRate(
        `sessions-revoke-one:${session.user.id}`,
        SESSIONS_REVOKE_RATE.max,
        SESSIONS_REVOKE_RATE.windowMs,
      )
    ) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many session revokes",
      });
      return true;
    }
    const revoked = revokeSessionById(session.user.id, id);
    if (!revoked) {
      sendJson(req, res, 404, { error: "not_found" });
      return true;
    }
    const signedOut = id === session.sessionId;
    sendJson(
      req,
      res,
      200,
      {
        ok: true,
        signedOut,
        sessions: signedOut
          ? []
          : publicSessions(session.user.id, session.sessionId),
      },
      signedOut ? [sessionClearCookie(req)] : [],
    );
    return true;
  }

  return false;
}
