/**
 * Public-bind + session gate. Signup is open; a session is still required
 * unless AUTH_REQUIRED is explicitly off on loopback.
 */
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

export function bindHost(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.BIND_HOST?.trim();
  return raw || "127.0.0.1";
}

export function authRequired(env: NodeJS.ProcessEnv = process.env): boolean {
  // A public bind always requires auth; AUTH_REQUIRED=0 cannot silence the gate.
  const host = bindHost(env);
  const publicBind = host === "0.0.0.0" || host === "::" || host === "[::]";
  if (publicBind) return true;
  const flag = env.AUTH_REQUIRED?.trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  return true;
}

export function isPublicApiPath(pathname: string): boolean {
  if (pathname === "/api/health" || pathname === "/health") return true;
  if (pathname.startsWith("/api/auth")) return true;
  if (pathname === "/api/stripe/webhook") return true;
  if (pathname === "/api/x/activity") return true;
  if (pathname === "/api/onboarding/generate") return true;
  if (pathname === "/api/mail/unsubscribe") return true;
  return false;
}

// Cloudflare's published ranges — the only proxy whose forwarded headers we trust.
// https://www.cloudflare.com/ips-v4 and /ips-v6
const CLOUDFLARE_IPV4 = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

const CLOUDFLARE_IPV6 = [
  "2400:cb00::/32",
  "2606:4700::/32",
  "2803:f800::/32",
  "2405:b500::/32",
  "2405:8100::/32",
  "2a06:98c0::/29",
  "2c0f:f248::/32",
];

function ipToBigInt(ip: string): bigint | null {
  if (ip.includes(".")) {
    const bytes = ip.split(".");
    if (bytes.length !== 4) return null;
    let value = 0n;
    for (const part of bytes) {
      const n = Number(part);
      if (!Number.isInteger(n) || n < 0 || n > 255) return null;
      value = (value << 8n) | BigInt(n);
    }
    return value;
  }
  const [headRaw, tailRaw] = ip.split("::");
  const head = headRaw ? headRaw.split(":").filter(Boolean) : [];
  const tail = tailRaw ? tailRaw.split(":").filter(Boolean) : [];
  const missing = 8 - head.length - tail.length;
  if (ip.includes("::") ? missing <= 0 : missing !== 0) return null;
  const parts = [...head, ...new Array<string>(missing).fill("0"), ...tail];
  if (parts.length !== 8) return null;
  let value = 0n;
  for (const part of parts) {
    const n = parseInt(part, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xffff) return null;
    value = (value << 16n) | BigInt(n);
  }
  return value;
}

function ipInCidr(ip: string, cidr: string): boolean {
  const [network, prefixRaw] = cidr.split("/");
  const prefix = Number(prefixRaw);
  if (!network || !Number.isInteger(prefix)) return false;
  const ipNum = ipToBigInt(ip);
  const netNum = ipToBigInt(network);
  if (ipNum === null || netNum === null) return false;
  const bits = network.includes(":") ? 128 : 32;
  if (prefix < 0 || prefix > bits) return false;
  if (prefix === 0) return true;
  const mask = ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
  return (ipNum & mask) === (netNum & mask);
}

export function isCloudflarePeer(address: string | undefined): boolean {
  if (!address) return false;
  return [...CLOUDFLARE_IPV4, ...CLOUDFLARE_IPV6].some((range) =>
    ipInCidr(address, range),
  );
}

function isLoopbackPeer(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

/** One IP, no list. Rejects spoof-shaped values. */
function singleHeaderIp(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.includes(",") || isIP(value) === 0) return null;
  return value;
}

/**
 * Client IP for rate limiting and session IP tracking.
 *
 * - Cloudflare peer: CF-Connecting-IP, then X-Forwarded-For.
 * - Loopback peer (local TLS terminator): X-Real-IP only. Nginx overwrites
 *   that header with $remote_addr. Do not trust X-Forwarded-For /
 *   CF-Connecting-IP here — those can keep a client-supplied first hop.
 * - Anyone else: socket address.
 */
export function clientIp(req: IncomingMessage): string {
  const peer = req.socket.remoteAddress || "unknown";
  if (isCloudflarePeer(peer)) {
    const cf = singleHeaderIp(req.headers["cf-connecting-ip"]);
    if (cf) return cf;
    const xff = req.headers["x-forwarded-for"];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim();
    if (first && isIP(first) !== 0) return first;
    return peer;
  }
  if (isLoopbackPeer(peer)) {
    const real = singleHeaderIp(req.headers["x-real-ip"]);
    if (real) return real;
  }
  return peer;
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
