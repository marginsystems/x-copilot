import { isRecord } from "../../../shared/src/typeGuards";
import { parseExtensionPair } from "../../../shared/src/extensionBridge";
import { apiBaseForDesk } from "./desks";

export type Pairing = { token: string; expiresAt: string; apiBase: string; deskOrigin: string };

export const PAIRING_STORAGE_KEY = "pairing";

export function pairingFromDesk(raw: unknown, deskOrigin: string): Pairing | null {
  const pair = parseExtensionPair(raw);
  if (!pair) return null;
  if (apiBaseForDesk(deskOrigin) !== pair.apiBase) return null;
  return { token: pair.token, expiresAt: pair.expiresAt, apiBase: pair.apiBase, deskOrigin };
}

export function parseStoredPairing(raw: unknown, nowMs: number): Pairing | null {
  if (!isRecord(raw)) return null;
  const { token, expiresAt, apiBase, deskOrigin } = raw;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "string" || !(Date.parse(expiresAt) > nowMs)) return null;
  if (typeof deskOrigin !== "string" || typeof apiBase !== "string") return null;
  if (apiBaseForDesk(deskOrigin) !== apiBase) return null;
  return { token, expiresAt, apiBase, deskOrigin };
}
