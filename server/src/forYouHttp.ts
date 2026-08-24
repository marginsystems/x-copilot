/**
 * For You suggestion inbox — list + I posted / Skip / Not interested.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { BODY_CAP_256K, readJsonBody, send } from "./httpJson.js";
import { getSessionUser } from "./sessionCookie.js";
import { countT24hSnapshots, MIN_T24H_SNAPSHOTS } from "./forYouDigest.js";
import {
  listActiveSuggestions,
  markSuggestion,
} from "./forYouStore.js";

export async function tryHandleForYou(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/for-you")) return false;

  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, {
      error: "unauthenticated",
      message: "Sign in required",
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/for-you") {
    const suggestions = listActiveSuggestions(user.id);
    send(req, res, 200, {
      ok: true,
      suggestions,
      tracked: countT24hSnapshots(user.id),
      needed: MIN_T24H_SNAPSHOTS,
    });
    return true;
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/api/for-you/done" ||
      url.pathname === "/api/for-you/skip" ||
      url.pathname === "/api/for-you/dismiss")
  ) {
    const body = await readJsonBody(req, { maxBytes: BODY_CAP_256K });
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      send(req, res, 400, { error: "bad_request", message: "id required" });
      return true;
    }
    const status =
      url.pathname === "/api/for-you/done" ? "done" : "skipped";
    const suggestion = markSuggestion({
      id,
      userId: user.id,
      status,
    });
    if (!suggestion) {
      send(req, res, 404, {
        error: "not_found",
        message: "Suggestion is gone or already acted on.",
      });
      return true;
    }
    send(req, res, 200, { ok: true, suggestion });
    return true;
  }

  send(req, res, 404, { error: "not_found" });
  return true;
}
