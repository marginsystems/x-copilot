import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import {
  EXTENSION_HELLO,
  EXTENSION_PAIRED,
  parseExtensionPair,
  parseExtensionPing,
  type ExtensionHello,
  type ExtensionPaired,
} from "../../../shared/src/extensionBridge";
import { parseScoutVisit } from "../../../shared/src/scoutVisit";
import { isRecord } from "../../../shared/src/typeGuards";
import { DESK_MATCHES } from "../lib/desks";
import { STORE_PAIRING } from "../lib/messages";
import { readPairing } from "../lib/pairingStore";
import { panelSide, relayScoutVisit } from "../lib/scoutVisit";

export default defineContentScript({
  matches: DESK_MATCHES,
  runAt: "document_idle",
  main() {
    const origin = window.location.origin;

    async function announce() {
      const pairing = await readPairing().catch(() => null);
      const hello: ExtensionHello = {
        type: EXTENSION_HELLO,
        version: browser.runtime.getManifest().version,
        paired: pairing?.deskOrigin === origin,
      };
      window.postMessage(hello, origin);
    }

    async function storePairing(pair: unknown) {
      const reply: unknown = await browser.runtime
        .sendMessage({ type: STORE_PAIRING, pair })
        .catch(() => null);
      const paired: ExtensionPaired = {
        type: EXTENSION_PAIRED,
        ok: isRecord(reply) && reply.ok === true,
      };
      window.postMessage(paired, origin);
    }

    async function relayVisit() {
      const accepted = await relayScoutVisit((message) => browser.runtime.sendMessage(message), panelSide());
      if (accepted) window.postMessage(accepted, origin);
    }

    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== window || event.origin !== origin) return;
      if (parseExtensionPing(event.data)) {
        announce().catch(() => undefined);
        return;
      }
      if (parseScoutVisit(event.data)) {
        relayVisit().catch(() => undefined);
        return;
      }
      if (parseExtensionPair(event.data)) {
        storePairing(event.data).catch(() => undefined);
      }
    });

    announce().catch(() => undefined);
  },
});
