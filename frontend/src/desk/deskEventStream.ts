import { useEffect } from "react";
import { apiFetch, apiUrl } from "../lib/apiBase";
import {
  DESK_DETECTOR_FALLBACK_MS,
  deskCatchUpDue,
  deskDetectorCheck,
  routeOwnPostWake,
  type DeskDetectorRoute,
} from "./approachDetector";

export type DeskEventName = "ready" | "own_post" | "interacted";

const DESK_EVENT_NAMES: DeskEventName[] = ["ready", "own_post", "interacted"];
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export const DESK_CATCH_UP_PATH = "/api/desk/own-posts/catch-up";

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
    let catchingUp = false;
    const catchUp = () => {
      if (!ownerId || !deskCatchUpDue(detectorRoute, document.visibilityState, catchingUp)) return;
      catchingUp = true;
      apiFetch(DESK_CATCH_UP_PATH, { method: "POST" })
        .finally(() => {
          catchingUp = false;
        })
        .catch(() => undefined);
    };
    const visible = () => {
      if (document.visibilityState !== "visible") return;
      catchUp();
      check();
    };
    const offReady = onDeskEvent("ready", check);
    const offOwnPost = onDeskEvent("own_post", (data) => {
      routeOwnPostWake(detectorRoute, data);
    });
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    const fallback = window.setInterval(check, DESK_DETECTOR_FALLBACK_MS);
    const close = ownerId && typeof EventSource !== "undefined" ? openDeskEventSource() : null;
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
