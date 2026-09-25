import { randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { corsHeaders } from "../http/cors.js";
import { BODY_CAP_16K, readJsonBody, send } from "../http/httpJson.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { isRecord } from "../platform/unknownValue.js";

type BufferedDeskEvent = { seq: number; type: DeskEventType; data: string; atMs: number };
type DeskEventType = "own_post" | "interacted";

export const DESK_EVENT_BUFFER_SIZE = 50;
export const DESK_EVENT_BUFFER_MS = 10 * 60_000;

const subscribers = new Map<string, Set<ServerResponse>>();
const buffers = new Map<string, BufferedDeskEvent[]>();
let bootId = randomUUID().slice(0, 8);
let seq = 0;
let warnedMissingSecret = false;

const INTERACTED_FIELDS = [
  "threadId", "author", "at", "url", "text", "summary",
  "replyId", "replyUrl", "postedAt", "conversationId", "inReplyToId",
] as const;

export type DeskInteractedPayload = Partial<Record<(typeof INTERACTED_FIELDS)[number], string>> & {
  threadId: string;
  author: string;
  at: string;
};

export function deskInteractedPayload(raw: unknown): DeskInteractedPayload | null {
  if (!isRecord(raw)) return null;
  const payload: Partial<Record<(typeof INTERACTED_FIELDS)[number], string>> = {};
  for (const field of INTERACTED_FIELDS) {
    const value = raw[field];
    if (typeof value === "string" && value.trim()) payload[field] = value;
  }
  const { threadId, author, at } = payload;
  if (!threadId || !author || !at || !Number.isFinite(Date.parse(at))) return null;
  return { ...payload, threadId, author, at };
}

function liveBuffer(userId: string, nowMs: number): BufferedDeskEvent[] {
  const buffer = (buffers.get(userId) ?? []).filter(
    (event) => nowMs - event.atMs < DESK_EVENT_BUFFER_MS,
  );
  if (buffer.length) buffers.set(userId, buffer);
  else buffers.delete(userId);
  return buffer;
}

function eventFrame(event: BufferedDeskEvent): string {
  return `id: ${bootId}.${event.seq}\nevent: ${event.type}\ndata: ${event.data}\n\n`;
}

function missedEvents(userId: string, lastEventId: string, nowMs: number): BufferedDeskEvent[] {
  if (!lastEventId) return [];
  const buffer = liveBuffer(userId, nowMs);
  const [lastBoot, lastSeq] = lastEventId.split(".");
  const after = Number(lastSeq);
  if (lastBoot !== bootId || !Number.isSafeInteger(after)) return buffer;
  return buffer.filter((event) => event.seq > after);
}

export function publishDeskEvent(
  userId: string,
  type: DeskEventType,
  payload: Record<string, unknown>,
  nowMs = Date.now(),
): void {
  const event: BufferedDeskEvent = { seq: ++seq, type, data: JSON.stringify(payload), atMs: nowMs };
  buffers.set(userId, [...liveBuffer(userId, nowMs), event].slice(-DESK_EVENT_BUFFER_SIZE));
  const frame = eventFrame(event);
  for (const subscriber of subscribers.get(userId) ?? []) {
    if (!subscriber.write(frame)) subscriber.destroy();
  }
}

export function warnIfDeskEventsSecretMissing(): void {
  if (process.env.DESK_EVENTS_SECRET?.trim() || warnedMissingSecret) return;
  warnedMissingSecret = true;
  console.warn("[desk] DESK_EVENTS_SECRET is empty; desk wakes will be rejected (403).");
}

export function resetDeskEventsForTests(): void {
  subscribers.clear();
  buffers.clear();
  bootId = randomUUID().slice(0, 8);
  seq = 0;
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
  if (body?.type === "interacted") {
    const interaction = deskInteractedPayload(body.interaction);
    if (typeof body.userId !== "string" || !body.userId || !interaction) {
      send(req, res, 400, { error: "bad_request" });
      return true;
    }
    publishDeskEvent(body.userId, "interacted", interaction);
    send(req, res, 200, { ok: true });
    return true;
  }
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
  publishDeskEvent(userId, "own_post", { id, kind, postedAt });
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
  const header = req.headers["last-event-id"];
  const lastEventId = (typeof header === "string" ? header : url.searchParams.get("lastEventId") ?? "").trim();
  const clients = subscribers.get(user.id) ?? new Set<ServerResponse>();
  subscribers.set(user.id, clients);
  clients.add(res);
  for (const event of missedEvents(user.id, lastEventId, Date.now())) res.write(eventFrame(event));
  res.write("retry: 1000\nevent: ready\ndata: {}\n\n");
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
