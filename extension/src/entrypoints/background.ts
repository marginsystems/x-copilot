import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { isWindowFocusedMessage, parseReplySeenMessage, parseStorePairingMessage } from "../lib/messages";
import { pairingFromDesk } from "../lib/pairing";
import { writePairing } from "../lib/pairingStore";
import { reportReply } from "../lib/reportReply";
import { toggleSidebarOnToolbarClick } from "../lib/toolbar";
import { senderWindowFocused } from "../lib/windowFocus";

function senderOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export default defineBackground(() => {
  if (import.meta.env.CHROME || import.meta.env.EDGE) {
    browser.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  } else {
    toggleSidebarOnToolbarClick(browser);
  }

  browser.runtime.onMessage.addListener((raw, sender) => {
    const seen = parseReplySeenMessage(raw);
    if (seen) {
      if (senderOrigin(sender.url) !== "https://x.com") return undefined;
      return reportReply(seen.replyUrl, seen.pageStatusId).then(
        () => ({ ok: true }),
        () => ({ ok: false }),
      );
    }
    if (isWindowFocusedMessage(raw)) return senderWindowFocused(sender, (windowId) => browser.windows.get(windowId));
    const message = parseStorePairingMessage(raw);
    if (!message) return undefined;
    const origin = senderOrigin(sender.url);
    const pairing = origin ? pairingFromDesk(message.pair, origin) : null;
    if (!pairing) return Promise.resolve({ ok: false });
    return writePairing(pairing).then(
      () => ({ ok: true }),
      () => ({ ok: false }),
    );
  });
});
