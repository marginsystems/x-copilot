import type { IncomingMessage, ServerResponse } from "node:http";
import { allowRate } from "../auth/authGuard.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { BodyError, readBody, send } from "../http/httpJson.js";
import { isRecord } from "../platform/unknownValue.js";
import { publishDeskEvent } from "./deskEvents.js";

export const APPROACH_NEXT_PATH = "/api/desk/approach/next";
export const APPROACH_NEXT_ID_MAX = 64;
export const APPROACH_NEXT_RATE = { max: 30, windowMs: 60_000 };

export async function tryHandleApproachNext(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== APPROACH_NEXT_PATH) return false;
  if (req.method !== "POST") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }
  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, { error: "unauthenticated", message: "Sign in required" });
    return true;
  }
  if (!allowRate(`approach-next:${user.id}`, APPROACH_NEXT_RATE.max, APPROACH_NEXT_RATE.windowMs)) {
    send(req, res, 429, { error: "rate_limited" });
    return true;
  }
  let body: unknown;
  try {
    body = await readBody(req);
  } catch (err) {
    send(req, res, err instanceof BodyError ? err.statusCode : 400, { error: "bad_request" });
    return true;
  }
  const fromCardId = isRecord(body) && typeof body.fromCardId === "string" ? body.fromCardId.trim() : "";
  if (!fromCardId || fromCardId.length > APPROACH_NEXT_ID_MAX) {
    send(req, res, 400, { error: "bad_request", message: "Pass { fromCardId: string }." });
    return true;
  }
  const delivered = publishDeskEvent(user.id, "approach_next", { fromCardId }) > 0;
  send(req, res, 200, { ok: true, delivered }, { "Cache-Control": "no-store" });
  return true;
}
