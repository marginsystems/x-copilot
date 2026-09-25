import { useEffect } from "react";
import { apiUrl } from "../lib/apiBase";

export type DeskEventName = "ready" | "own_post" | "interacted";

const DESK_EVENT_NAMES: DeskEventName[] = ["ready", "own_post", "interacted"];
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

type DeskEventListener = (data: unknown) => void;

const listeners = new Map<DeskEventName, Set<DeskEventListener>>();

export function onDeskEvent(
  name: DeskEventName,
  listener: DeskEventListener,
): () => void {
  const set = listeners.get(name) ?? new Set<DeskEventListener>();
  listeners.set(name, set);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function emitDeskEvent(name: DeskEventName, raw: string): void {
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }
  for (const listener of [...(listeners.get(name) ?? [])]) listener(data);
}

export function deskEventsPath(lastEventId: string): string {
  return lastEventId
    ? `/api/desk/events?lastEventId=${encodeURIComponent(lastEventId)}`
    : "/api/desk/events";
}

export function useDeskEventStream(ownerId: string | null): void {
  useEffect(() => {
    if (!ownerId || typeof EventSource === "undefined") return;
    let stopped = false;
    let source: EventSource | null = null;
    let lastEventId = "";
    let reconnectMs = RECONNECT_MIN_MS;
    let reconnectTimer: number | undefined;
    const connect = () => {
      const next = new EventSource(apiUrl(deskEventsPath(lastEventId)), {
        withCredentials: true,
      });
      source = next;
      for (const name of DESK_EVENT_NAMES) {
        next.addEventListener(name, (event) => {
          if (!(event instanceof MessageEvent)) return;
          if (event.lastEventId) lastEventId = event.lastEventId;
          if (name === "ready") reconnectMs = RECONNECT_MIN_MS;
          emitDeskEvent(name, typeof event.data === "string" ? event.data : "");
        });
      }
      next.addEventListener("error", () => {
        if (stopped || next.readyState !== EventSource.CLOSED) return;
        reconnectTimer = window.setTimeout(connect, reconnectMs);
        reconnectMs = Math.min(reconnectMs * 2, RECONNECT_MAX_MS);
      });
    };
    connect();
    return () => {
      stopped = true;
      source?.close();
      window.clearTimeout(reconnectTimer);
    };
  }, [ownerId]);
}
