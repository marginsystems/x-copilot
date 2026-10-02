import { browser } from "wxt/browser";
import { PAIRING_STORAGE_KEY, parseStoredPairing, type Pairing } from "./pairing";

export async function readPairing(nowMs = Date.now()): Promise<Pairing | null> {
  const stored = await browser.storage.local.get(PAIRING_STORAGE_KEY);
  return parseStoredPairing(stored[PAIRING_STORAGE_KEY], nowMs);
}

export async function writePairing(pairing: Pairing): Promise<void> {
  await browser.storage.local.set({ [PAIRING_STORAGE_KEY]: pairing });
}

export async function clearPairing(): Promise<void> {
  await browser.storage.local.remove(PAIRING_STORAGE_KEY);
}
