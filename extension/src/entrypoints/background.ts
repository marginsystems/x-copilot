import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { parseStorePairingMessage } from "../lib/messages";
import { pairingFromDesk } from "../lib/pairing";
import { writePairing } from "../lib/pairingStore";

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
  }

  browser.runtime.onMessage.addListener((raw, sender) => {
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
