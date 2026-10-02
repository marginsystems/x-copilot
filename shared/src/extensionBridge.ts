import { isRecord } from "./typeGuards.ts";

export const EXTENSION_SESSION_PATH = "/api/auth/extension-session";
export const EXTENSION_PING = "x-copilot:extension-ping";
export const EXTENSION_HELLO = "x-copilot:extension-hello";
export const EXTENSION_PAIR = "x-copilot:extension-pair";
export const EXTENSION_PAIRED = "x-copilot:extension-paired";
export const EXTENSION_PAIR_ACK_MS = 5_000;

export type ExtensionPing = { type: typeof EXTENSION_PING };
export type ExtensionHello = { type: typeof EXTENSION_HELLO; version: string; paired: boolean };
export type ExtensionPair = {
  type: typeof EXTENSION_PAIR;
  token: string;
  expiresAt: string;
  apiBase: string;
};
export type ExtensionPaired = { type: typeof EXTENSION_PAIRED; ok: boolean };

export function parseExtensionPing(raw: unknown): ExtensionPing | null {
  return isRecord(raw) && raw.type === EXTENSION_PING ? { type: EXTENSION_PING } : null;
}

export function parseExtensionHello(raw: unknown): ExtensionHello | null {
  if (!isRecord(raw) || raw.type !== EXTENSION_HELLO) return null;
  if (typeof raw.version !== "string" || typeof raw.paired !== "boolean") return null;
  return { type: EXTENSION_HELLO, version: raw.version, paired: raw.paired };
}

export function parseExtensionPair(raw: unknown): ExtensionPair | null {
  if (!isRecord(raw) || raw.type !== EXTENSION_PAIR) return null;
  const { token, expiresAt, apiBase } = raw;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return null;
  if (typeof apiBase !== "string" || !/^https?:\/\/[^/]+$/.test(apiBase)) return null;
  return { type: EXTENSION_PAIR, token, expiresAt, apiBase };
}

export function parseExtensionPaired(raw: unknown): ExtensionPaired | null {
  if (!isRecord(raw) || raw.type !== EXTENSION_PAIRED || typeof raw.ok !== "boolean") return null;
  return { type: EXTENSION_PAIRED, ok: raw.ok };
}

export function parseExtensionSessionGrant(raw: unknown): { token: string; expiresAt: string } | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  const { token, expiresAt } = raw;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))) return null;
  return { token, expiresAt };
}
