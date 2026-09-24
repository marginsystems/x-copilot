import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { corsHeaders } from "../http/cors.js";
import { BODY_CAP_16K, readJsonBody, send } from "../http/httpJson.js";
import { getSessionUser } from "../auth/sessionCookie.js";

const subscribers = new Map<string, Set<ServerResponse>>();
let warnedMissingSecret = false;

export function warnIfDeskEventsSecretMissing(): void {
  if (process.env.DESK_EVENTS_SECRET?.trim() || warnedMissingSecret) return;
  warnedMissingSecret = true;
  console.warn("[desk] DESK_EVENTS_SECRET is empty; desk wakes will be rejected (403).");
}

export function resetDeskEventsForTests(): void {
  subscribers.clear();
  warnedMissingSecret = false;
}

/** Runs before the cookie gate; the webhook sidecar must present the shared secret. */
export async function tryHandleDeskEventsWake(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/desk/events/wake") return false;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "")) {
    send(req, res, 403, { error: "forbidden" });
    return true;
  }
  const expected = process.env.DESK_EVENTS_SECRET?.trim();
  const authorization = req.headers.authorization;
  const provided =
    typeof authorization === "string" && authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
  const expectedBytes = Buffer.from(expected ?? "");
  const providedBytes = Buffer.from(provided);
  if (
    !expected ||
    expectedBytes.length !== providedBytes.length ||
    !timingSafeEqual(expectedBytes, providedBytes)
  ) {
    send(req, res, 403, { error: "forbidden" });
    return true;
  }
  if (req.method !== "POST") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }
  const body = await readJsonBody(req, { maxBytes: BODY_CAP_16K });
  const { userId, id, kind, postedAt } = body ?? {};
  if (
    typeof userId !== "string" || !userId ||
    typeof id !== "string" || !id ||
    (kind !== "reply" && kind !== "original" && kind !== "quote") ||
    typeof postedAt !== "string" || !Number.isFinite(Date.parse(postedAt))
  ) {
    send(req, res, 400, { error: "bad_request" });
    return true;
  }
  const event = `event: own_post\ndata: ${JSON.stringify({ id, kind, postedAt })}\n\n`;
  for (const subscriber of subscribers.get(userId) ?? []) {
    // A slow desk can reconnect and recover through the lite poll.
    if (!subscriber.write(event)) subscriber.destroy();
  }
  send(req, res, 200, { ok: true });
  return true;
}

export function tryHandleDeskEvents(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): boolean {
  if (url.pathname !== "/api/desk/events" || req.method !== "GET") return false;
  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, { error: "unauthenticated", message: "Sign in required" });
    return true;
  }
  res.writeHead(200, {
    ...corsHeaders(req),
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  const clients = subscribers.get(user.id) ?? new Set<ServerResponse>();
  subscribers.set(user.id, clients);
  clients.add(res);
  res.write("event: ready\ndata: {}\n\n");
  const heartbeat = setInterval(() => {
    if (!res.write(": heartbeat\n\n")) res.destroy();
  }, 15_000);
  heartbeat.unref();
  const unsubscribe = () => {
    clearInterval(heartbeat);
    clients.delete(res);
    if (clients.size === 0) subscribers.delete(user.id);
  };
  req.once("close", unsubscribe);
  res.once("close", unsubscribe);
  return true;
}
