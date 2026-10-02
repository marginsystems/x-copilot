import { useCallback, useEffect, useRef, useState } from "react";
import {
  EXTENSION_PAIR,
  EXTENSION_PAIR_ACK_MS,
  EXTENSION_PING,
  EXTENSION_SESSION_PATH,
  parseExtensionHello,
  parseExtensionPaired,
  parseExtensionSessionGrant,
  type ExtensionHello,
  type ExtensionPair,
} from "../../../shared/src/extensionBridge";
import { apiBase, apiFetch } from "./apiBase";

export type ExtensionConnectState =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "failed"; message: string };

function fromThisPage(event: MessageEvent): boolean {
  return event.source === window && event.origin === window.location.origin;
}

export function useExtensionBridge(): {
  hello: ExtensionHello | null;
  state: ExtensionConnectState;
  connect: () => Promise<void>;
} {
  const [hello, setHello] = useState<ExtensionHello | null>(null);
  const [state, setState] = useState<ExtensionConnectState>({ kind: "idle" });
  const ackRef = useRef<((ok: boolean) => void) | null>(null);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!fromThisPage(event)) return;
      const nextHello = parseExtensionHello(event.data);
      if (nextHello) {
        setHello(nextHello);
        return;
      }
      const paired = parseExtensionPaired(event.data);
      if (paired) ackRef.current?.(paired.ok);
    }
    window.addEventListener("message", onMessage);
    window.postMessage({ type: EXTENSION_PING }, window.location.origin);
    return () => {
      window.removeEventListener("message", onMessage);
      ackRef.current = null;
    };
  }, []);

  const connect = useCallback(async () => {
    setState({ kind: "connecting" });
    try {
      const res = await apiFetch(EXTENSION_SESSION_PATH, { method: "POST" });
      const grant = parseExtensionSessionGrant(await res.json().catch(() => null));
      if (!res.ok || !grant) {
        setState({ kind: "failed", message: `Could not create an extension sign-in (${res.status}).` });
        return;
      }
      const acked = new Promise<boolean | null>((resolve) => {
        const timer = window.setTimeout(() => resolve(null), EXTENSION_PAIR_ACK_MS);
        ackRef.current = (ok) => {
          window.clearTimeout(timer);
          ackRef.current = null;
          resolve(ok);
        };
      });
      const message: ExtensionPair = {
        type: EXTENSION_PAIR,
        token: grant.token,
        expiresAt: grant.expiresAt,
        apiBase: apiBase(),
      };
      window.postMessage(message, window.location.origin);
      const ack = await acked;
      setState(ack === true
        ? { kind: "connected" }
        : { kind: "failed", message: ack === false
          ? "The extension rejected the sign-in. Check the extension and try again."
          : "The extension did not answer. Reload this page and try again." });
    } catch (err) {
      setState({ kind: "failed", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  return { hello, state, connect };
}
