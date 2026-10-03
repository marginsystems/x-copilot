import type { IncomingMessage, ServerResponse } from "node:http";
import { getSessionUser } from "../auth/sessionCookie.js";
import { corsHeaders } from "../http/cors.js";
import { send } from "../http/httpJson.js";

export const SCOUT_APPROACH_LOCK_EVENTS_PATH = "/api/scout-approach-lock/events";
export const SCOUT_APPROACH_LOCK_CHANGED_EVENT = "lock_changed";
export const SCOUT_APPROACH_LOCK_WATCHERS_MAX = 6;

const HEARTBEAT_MS = 15_000;
const CHANGED_FRAME = `event: ${SCOUT_APPROACH_LOCK_CHANGED_EVENT}\ndata: {}\n\n`;

const watchers = new Map<string, Set<ServerResponse>>();

export function publishScoutApproachLockChanged(userId: string): number {
  let delivered = 0;
  for (const watcher of watchers.get(userId) ?? []) {
    if (watcher.write(CHANGED_FRAME)) delivered += 1;
    else watcher.destroy();
  }
  return delivered;
}

export function scoutApproachLockWritten(req: IncomingMessage, res: ServerResponse): boolean {
  return req.method === "PUT" && res.statusCode === 200;
}

export function resetScoutApproachLockEventsForTests(): void {
  watchers.clear();
}

export function tryHandleScoutApproachLockEvents(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  if (url.pathname !== SCOUT_APPROACH_LOCK_EVENTS_PATH) return false;
  if (req.method !== "GET") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }
  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, { error: "unauthenticated" });
    return true;
  }
  const clients = watchers.get(user.id) ?? new Set<ServerResponse>();
  watchers.set(user.id, clients);
  while (clients.size >= SCOUT_APPROACH_LOCK_WATCHERS_MAX) {
    const oldest = clients.values().next().value;
    if (!oldest) break;
    clients.delete(oldest);
    oldest.destroy();
  }
  res.writeHead(200, {
    ...corsHeaders(req),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  clients.add(res);
  res.write("event: ready\ndata: {}\n\n");
  const heartbeat = setInterval(() => {
    if (!res.write(": heartbeat\n\n")) res.destroy();
  }, HEARTBEAT_MS);
  heartbeat.unref();
  const unsubscribe = () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0 && watchers.get(user.id) === clients) watchers.delete(user.id);
  };
  req.once("close", unsubscribe);
  res.once("close", unsubscribe);
  return true;
}
