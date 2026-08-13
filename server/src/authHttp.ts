/**
 * Auth HTTP routes: Google OAuth, session me/logout.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { revokeSessionToken } from "./authStore.js";
import { corsHeaders } from "./cors.js";
import { handleGoogleCallback, handleGoogleStart } from "./googleAuth.js";
import {
  getSessionUser,
  requestCookies,
  SESSION_COOKIE,
  sessionClearCookie,
} from "./sessionCookie.js";

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
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
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
    handleGoogleStart(req, res);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/google/callback") {
    await handleGoogleCallback(req, res, url);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/auth/me") {
    const user = getSessionUser(req);
    if (!user) {
      sendJson(req, res, 401, { ok: false, error: "unauthenticated" });
      return true;
    }
    sendJson(req, res, 200, { ok: true, user: publicUser(user) });
    return true;
  }
  if (
    (req.method === "POST" || req.method === "GET") &&
    url.pathname === "/api/auth/logout"
  ) {
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
