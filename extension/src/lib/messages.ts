import { isRecord } from "../../../shared/src/typeGuards";

export const STORE_PAIRING = "x-copilot:store-pairing";

export type StorePairingMessage = { type: typeof STORE_PAIRING; pair: unknown };

export function parseStorePairingMessage(raw: unknown): StorePairingMessage | null {
  return isRecord(raw) && raw.type === STORE_PAIRING ? { type: STORE_PAIRING, pair: raw.pair } : null;
}
