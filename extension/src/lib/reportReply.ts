import { browser } from "wxt/browser";
import { OWN_POST_SEEN_PATH } from "../../../shared/src/extensionBridge";
import { ApiStatusError, apiRequest } from "./api";
import type { Pairing } from "./pairing";
import { readPairing } from "./pairingStore";
import {
  postedStatusUrl,
  replyReport,
  REPLIED_CARD_KEY,
  REPLY_PACE_AT_KEY,
  REPLY_SEEN_KEY,
  seenPostBody,
} from "./replySeen";
import { readScoutLock } from "./scoutLock";

const INTERACTED_PATH = "/api/interacted";
const OWN_POST_CATCH_UP_PATH = "/api/desk/own-posts/catch-up";

async function reportSeenPost(pairing: Pairing, replyUrl: string, pageStatusId: string | null): Promise<void> {
  const body = seenPostBody(replyUrl, pageStatusId);
  if (!body) return;
  await apiRequest(pairing, OWN_POST_SEEN_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err: unknown) => {
    if (!(err instanceof ApiStatusError)) throw err;
  });
}

export async function reportReply(rawReplyUrl: string, pageStatusId: string | null): Promise<void> {
  const replyUrl = postedStatusUrl(rawReplyUrl);
  const pairing = await readPairing();
  if (!replyUrl) return;
  if (!pairing) throw new Error("The extension is not paired");
  if (pageStatusId) await browser.storage.local.set({ [REPLY_PACE_AT_KEY]: Date.now() }).catch(() => undefined);
  await reportSeenPost(pairing, replyUrl, pageStatusId);
  const lock = await readScoutLock(pairing);
  const report = replyReport(lock.card, pageStatusId, replyUrl);
  if (report.kind === "scout") {
    await apiRequest(pairing, INTERACTED_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report.body),
    });
  } else {
    await apiRequest(pairing, OWN_POST_CATCH_UP_PATH, { method: "POST" });
  }
  const seenAt = Date.now();
  const seen = {
    [REPLY_SEEN_KEY]: seenAt,
    ...(report.kind === "scout" ? { [REPLIED_CARD_KEY]: report.body.threadId } : {}),
  };
  await browser.storage.local.set(seen).catch(() => undefined);
}
