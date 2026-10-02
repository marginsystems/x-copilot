import { browser } from "wxt/browser";
import {
  parseScoutApproachLockResponse,
  SCOUT_APPROACH_LOCK_PATH,
} from "../../../shared/src/scoutApproachLock";
import { apiRequest } from "./api";
import { readPairing } from "./pairingStore";
import { postedStatusUrl, replyReport, REPLIED_CARD_KEY, REPLY_SEEN_KEY } from "./replySeen";

const INTERACTED_PATH = "/api/interacted";
const OWN_POST_CATCH_UP_PATH = "/api/desk/own-posts/catch-up";

export async function reportReply(rawReplyUrl: string, pageStatusId: string | null): Promise<void> {
  const replyUrl = postedStatusUrl(rawReplyUrl);
  const pairing = await readPairing();
  if (!replyUrl) return;
  if (!pairing) throw new Error("The extension is not paired");
  const lock = parseScoutApproachLockResponse(await apiRequest(pairing, SCOUT_APPROACH_LOCK_PATH));
  const report = replyReport(lock?.card ?? null, pageStatusId, replyUrl);
  if (report.kind === "scout") {
    await apiRequest(pairing, INTERACTED_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report.body),
    });
  } else {
    await apiRequest(pairing, OWN_POST_CATCH_UP_PATH, { method: "POST" });
  }
  const seen = report.kind === "scout"
    ? { [REPLY_SEEN_KEY]: Date.now(), [REPLIED_CARD_KEY]: report.body.threadId }
    : { [REPLY_SEEN_KEY]: Date.now() };
  await browser.storage.local.set(seen).catch(() => undefined);
}
