/**
 * HttpOnly session + OAuth state cookies.
 */
import type { IncomingMessage, OutgoingHttpHeaders } from "node:http";
import { randomBytes } from "node:crypto";
import { getUserForSessionToken, type AuthUser } from "./authStore.js";

export const SESSION_COOKIE = "xc_session";
export const OAUTH_STATE_COOKIE = "xc_oauth_state";

const SESSION_MAX_AGE_SEC = 30 * 24 * 60 * 60;
const OAUTH_STATE_MAX_AGE_SEC = 10 * 60;

export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    const v = part.slice(i + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export function requestCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie;
  return parseCookies(typeof raw === "string" ? raw : undefined);
}

function forwardedProto(req: IncomingMessage): string {
  const raw = req.headers["x-forwarded-proto"];
  const first = (Array.isArray(raw) ? raw[0] : raw)?.split(",")[0]?.trim();
  if (first) return first.toLowerCase();
  const socket = req.socket as { encrypted?: boolean };
  return socket.encrypted ? "https" : "http";
}

function requestHost(req: IncomingMessage): string {
  const raw = req.headers.host ?? "";
  return raw.split(":")[0]?.toLowerCase() || "";
}

export function cookieFlags(req: IncomingMessage): {
  secure: boolean;
  sameSite: "None" | "Lax";
} {
  const host = requestHost(req);
  const isLocal = host === "127.0.0.1" || host === "localhost";
  if (isLocal) {
    return { secure: false, sameSite: "Lax" };
  }
  // Cross-site SPA (xcopilot.dev → api.xcopilot.dev) needs None+Secure.
  // Trust CF's X-Forwarded-Proto so origin HTTP behind orange-cloud still sets Secure.
  const https = forwardedProto(req) === "https";
  return { secure: https, sameSite: https ? "None" : "Lax" };
}

export function serializeCookie(
  name: string,
  value: string,
  opts: {
    maxAgeSec?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "None" | "Lax" | "Strict";
    path?: string;
    clear?: boolean;
  },
): string {
  const parts = [
    `${name}=${opts.clear ? "" : encodeURIComponent(value)}`,
    `Path=${opts.path ?? "/"}`,
  ];
  if (opts.clear) {
    parts.push("Max-Age=0");
  } else if (opts.maxAgeSec != null) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
  }
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  if (opts.secure) parts.push("Secure");
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  return parts.join("; ");
}

export function sessionSetCookie(req: IncomingMessage, token: string): string {
  const flags = cookieFlags(req);
  return serializeCookie(SESSION_COOKIE, token, {
    maxAgeSec: SESSION_MAX_AGE_SEC,
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
  });
}

export function sessionClearCookie(req: IncomingMessage): string {
  const flags = cookieFlags(req);
  return serializeCookie(SESSION_COOKIE, "", {
    clear: true,
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
  });
}

export function oauthStateSetCookie(req: IncomingMessage, state: string): string {
  const flags = cookieFlags(req);
  return serializeCookie(OAUTH_STATE_COOKIE, state, {
    maxAgeSec: OAUTH_STATE_MAX_AGE_SEC,
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
  });
}

export function oauthStateClearCookie(req: IncomingMessage): string {
  const flags = cookieFlags(req);
  return serializeCookie(OAUTH_STATE_COOKIE, "", {
    clear: true,
    httpOnly: true,
    secure: flags.secure,
    sameSite: flags.sameSite,
  });
}

export function newOauthState(): string {
  return randomBytes(24).toString("base64url");
}

export function getSessionUser(req: IncomingMessage): AuthUser | null {
  const token = requestCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return getUserForSessionToken(token);
}

export function appendSetCookie(
  headers: OutgoingHttpHeaders,
  cookie: string,
): void {
  const existing = headers["Set-Cookie"] ?? headers["set-cookie"];
  if (!existing) {
    headers["Set-Cookie"] = cookie;
    return;
  }
  const list = Array.isArray(existing) ? existing.map(String) : [String(existing)];
  list.push(cookie);
  headers["Set-Cookie"] = list;
}
