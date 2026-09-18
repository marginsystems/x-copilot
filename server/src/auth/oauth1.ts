/**
 * OAuth 1.0a HMAC-SHA1 (RFC 5849) — used for X 3-legged login.
 */
import { createHmac, randomBytes } from "node:crypto";

export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => {
    return `%${c.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}

export function signatureBaseString(opts: {
  method: string;
  url: string;
  params: Record<string, string>;
}): string {
  const parsed = new URL(opts.url);
  parsed.search = "";
  parsed.hash = "";
  const baseUrl = parsed.toString();
  const normalized = Object.keys(opts.params)
    .filter((k) => k !== "oauth_signature")
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(opts.params[k]!)}`)
    .join("&");
  return [
    opts.method.toUpperCase(),
    percentEncode(baseUrl),
    percentEncode(normalized),
  ].join("&");
}

export function signOauth1(opts: {
  method: string;
  url: string;
  params: Record<string, string>;
  consumerSecret: string;
  tokenSecret?: string;
}): string {
  const base = signatureBaseString(opts);
  const key = `${percentEncode(opts.consumerSecret)}&${percentEncode(opts.tokenSecret ?? "")}`;
  return createHmac("sha1", key).update(base).digest("base64");
}

export function authorizationHeader(params: Record<string, string>): string {
  const keys = Object.keys(params)
    .filter((k) => k.startsWith("oauth_"))
    .sort();
  const parts = keys.map(
    (k) => `${percentEncode(k)}="${percentEncode(params[k]!)}"`,
  );
  return `OAuth ${parts.join(", ")}`;
}

export function oauth1Nonce(): string {
  return randomBytes(16).toString("hex");
}

export function buildSignedAuthHeader(opts: {
  method: string;
  url: string;
  consumerKey: string;
  consumerSecret: string;
  token?: string;
  tokenSecret?: string;
  extraOauth?: Record<string, string>;
  query?: Record<string, string>;
  nonce?: string;
  timestamp?: string;
}): { header: string; params: Record<string, string> } {
  const params: Record<string, string> = {
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: opts.nonce ?? oauth1Nonce(),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: opts.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
    ...(opts.token ? { oauth_token: opts.token } : {}),
    ...(opts.extraOauth ?? {}),
    ...(opts.query ?? {}),
  };
  params.oauth_signature = signOauth1({
    method: opts.method,
    url: opts.url,
    params,
    consumerSecret: opts.consumerSecret,
    tokenSecret: opts.tokenSecret,
  });
  return { header: authorizationHeader(params), params };
}

export function parseFormEncoded(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of body.split("&")) {
    if (!part) continue;
    const i = part.indexOf("=");
    const k = i === -1 ? part : part.slice(0, i);
    const v = i === -1 ? "" : part.slice(i + 1);
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, " "));
    } catch {
      out[k] = v;
    }
  }
  return out;
}
