import { browser } from "wxt/browser";
import { REPLIED_CARD_KEY } from "./replySeen";

export async function readRepliedCardId(): Promise<string | null> {
  const stored = await browser.storage.local.get(REPLIED_CARD_KEY);
  const value: unknown = stored[REPLIED_CARD_KEY];
  return typeof value === "string" && value ? value : null;
}
