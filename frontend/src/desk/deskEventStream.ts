import { useEffect } from "react";
import { apiUrl } from "../lib/apiBase";
import {
  DESK_DETECTOR_FALLBACK_MS,
  deskDetectorCheck,
  routeOwnPostWake,
  type DeskDetectorRoute,
} from "./approachDetector";

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

let detectorRoute: DeskDetectorRoute | null = null;

export function routeDeskDetector(route: DeskDetectorRoute): () => void {
  detectorRoute = route;
  return () => {
    if (detectorRoute === route) detectorRoute = null;
  };
}

function openDeskEventSource(): () => void {
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
}

export function useDeskEventStream(ownerId: string | null): void {
  useEffect(() => {
    if (!ownerId) return;
    let checking = false;
    const runCheck = async (run: () => void | Promise<void>) => {
      checking = true;
      try {
        await run();
      } finally {
        checking = false;
      }
    };
    const check = () => {
      const route = detectorRoute;
      const target = deskDetectorCheck(route, checking);
      if (!route || !target) return;
      runCheck(route.check[target]).catch((err: unknown) => console.error(err));
    };
    const visible = () => {
      if (document.visibilityState === "visible") check();
    };
    const offReady = onDeskEvent("ready", check);
    const offOwnPost = onDeskEvent("own_post", (data) => {
      routeOwnPostWake(detectorRoute, data);
    });
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    const fallback = window.setInterval(check, DESK_DETECTOR_FALLBACK_MS);
    const close = typeof EventSource === "undefined" ? null : openDeskEventSource();
    return () => {
      close?.();
      offReady();
      offOwnPost();
      window.clearInterval(fallback);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [ownerId]);
}
