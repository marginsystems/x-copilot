/**
 * Public-bind + session gate. Local loopback stays open unless a whitelist is set.
 */
import type { IncomingMessage } from "node:http";
import { parseEmailWhitelist } from "./authConfig.js";

export function bindHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BIND_HOST?.trim();
  return raw || "127.0.0.1";
}

export function authRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.AUTH_REQUIRED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  if (parseEmailWhitelist(env.AUTH_EMAIL_WHITELIST).length > 0) return true;
  const host = bindHost(env);
  return host === "0.0.0.0" || host === "::" || host === "[::]";
}

export function isPublicApiPath(pathname: string): boolean {
  if (pathname === "/api/health" || pathname === "/health") return true;
  if (pathname.startsWith("/api/auth")) return true;
  return false;
}

export function clientIp(req: IncomingMessage): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = req.headers["x-forwarded-for"];
  const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
  if (first) return first;
  return req.socket.remoteAddress || "unknown";
}

const hits = new Map<string, number[]>();

/** Longest window passed to allowRate; keys idle longer than this are swept. */
let maxRateWindowMs = 0;

export function resetRateLimiterForTests(): void {
  hits.clear();
}

/** Expire keys idle for a full window so the map stays bounded by active keys. */
function sweepStaleRateKeys(now = Date.now()): void {
  if (maxRateWindowMs <= 0) return;
  for (const [key, times] of hits) {
    if (now - times[times.length - 1] >= maxRateWindowMs) {
      hits.delete(key);
    }
  }
}

/** True if the key is still under the limit (and this hit is recorded). */
export function allowRate(
  key: string,
  max: number,
  windowMs: number,
  now = Date.now(),
): boolean {
  maxRateWindowMs = Math.max(maxRateWindowMs, windowMs);
  const next = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (next.length === 0) {
    hits.delete(key);
  }
  if (next.length >= max) {
    if (next.length > 0) hits.set(key, next);
    return false;
  }
  next.push(now);
  hits.set(key, next);
  return true;
}

export const AUTH_START_RATE = { max: 20, windowMs: 10 * 60 * 1000 };

// Bound memory: expire keys idle for a full window. Unref'd so tests/CLI exit.
setInterval(() => sweepStaleRateKeys(), AUTH_START_RATE.windowMs).unref();
