/**
 * Credentialed CORS for the SPA on localhost / xcopilot.dev talking to the API.
 */
import type { IncomingMessage } from "node:http";

const LOCAL_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

export function parseAllowedOrigins(
  raw: string | undefined = process.env.ALLOWED_ORIGINS,
): string[] {
  const extra = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (extra.length === 0) {
    return [...LOCAL_ORIGINS];
  }
  return [...new Set(extra)];
}

export function requestOrigin(req: IncomingMessage): string | undefined {
  const raw = req.headers.origin;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowed: string[] = parseAllowedOrigins(),
): boolean {
  if (!origin) return true;
  return allowed.includes(origin);
}

export function isLocalOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const hostname = new URL(origin).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function corsHeaders(
  req: IncomingMessage,
  allowed: string[] = parseAllowedOrigins(),
): Record<string, string> {
  const origin = requestOrigin(req);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
  if (origin && allowed.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}
