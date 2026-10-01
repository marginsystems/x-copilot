import type { IncomingMessage, ServerResponse } from "node:http";
import { isOriginAllowed, requestOrigin } from "../http/cors.js";
import { send } from "../http/httpJson.js";
import { allowRate, clientIp } from "./authGuard.js";
import { getRequestSession, requestBearerToken } from "./sessionCookie.js";
import { createSession, revokeSessionById } from "./sessionStore.js";

export const EXTENSION_SESSION_PATH = "/api/auth/extension-session";
export const EXTENSION_PAIR_RATE = { max: 10, windowMs: 10 * 60 * 1000 };

const NO_STORE = { "Cache-Control": "no-store" };

function pairExtension(req: IncomingMessage, res: ServerResponse): void {
  if (!isOriginAllowed(requestOrigin(req))) {
    send(req, res, 403, { error: "forbidden", message: "Origin not allowed" });
    return;
  }
  if (requestBearerToken(req) !== null) {
    send(req, res, 403, { error: "forbidden", message: "Pair from the desk" });
    return;
  }
  const session = getRequestSession(req);
  if (!session) {
    send(req, res, 401, { error: "unauthenticated", message: "Sign in required" });
    return;
  }
  const userId = session.user.id;
  if (!allowRate(`extension-pair:${userId}`, EXTENSION_PAIR_RATE.max, EXTENSION_PAIR_RATE.windowMs)) {
    send(req, res, 429, { error: "rate_limited", message: "Too many pairing requests" });
    return;
  }
  const ua = req.headers["user-agent"];
  const paired = createSession(
    userId,
    { ip: clientIp(req), userAgent: typeof ua === "string" ? ua : null },
    "extension",
  );
  send(req, res, 201, { ok: true, token: paired.token, expiresAt: paired.expiresAt }, NO_STORE);
}

function unpairExtension(req: IncomingMessage, res: ServerResponse): void {
  const session = requestBearerToken(req) !== null ? getRequestSession(req) : null;
  if (!session) {
    send(req, res, 401, { error: "unauthenticated", message: "Sign in required" });
    return;
  }
  revokeSessionById(session.user.id, session.sessionId);
  send(req, res, 200, { ok: true }, NO_STORE);
}

export function tryHandleExtensionSession(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  if (url.pathname !== EXTENSION_SESSION_PATH) return false;
  if (req.method === "POST") pairExtension(req, res);
  else if (req.method === "DELETE") unpairExtension(req, res);
  else send(req, res, 405, { error: "method_not_allowed" }, { Allow: "POST, DELETE" });
  return true;
}
