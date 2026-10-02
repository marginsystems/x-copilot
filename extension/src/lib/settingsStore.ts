import { browser } from "wxt/browser";
import { ATTENTION_GATE_KEY, parseAttentionGate } from "./settings";

export async function readAttentionGate(): Promise<boolean> {
  const stored = await browser.storage.local.get(ATTENTION_GATE_KEY);
  return parseAttentionGate(stored[ATTENTION_GATE_KEY]);
}

export async function writeAttentionGate(on: boolean): Promise<void> {
  await browser.storage.local.set({ [ATTENTION_GATE_KEY]: on });
}
