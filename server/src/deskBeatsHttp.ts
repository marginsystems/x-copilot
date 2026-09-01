import type { IncomingMessage, ServerResponse } from "node:http";
import { chooseDeskFork, recordDeskOriginalPosted } from "./deskBeats.js";
import { BODY_CAP_256K, readJsonBody, send } from "./httpJson.js";
import { getSessionUser } from "./sessionCookie.js";

export async function tryHandleDeskBeats(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/desk/beats") return false;
  if (req.method !== "POST") return false;

  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, {
      error: "unauthenticated",
      message: "Sign in required",
    });
    return true;
  }

  const body = await readJsonBody(req, { maxBytes: BODY_CAP_256K });
  const forkChoice = body?.forkChoice;
  if (body?.originalPosted === true) {
    try {
      const beats = recordDeskOriginalPosted({ userId: user.id });
      send(req, res, 200, { ok: true, beats });
    } catch (err) {
      console.error("desk beats original write failed:", err);
      send(req, res, 500, {
        error: "store_failed",
        message: "Failed to update desk beats",
      });
    }
    return true;
  }
  if (forkChoice !== "original" && forkChoice !== "reply") {
    send(req, res, 400, {
      error: "bad_request",
      message: 'Pass { forkChoice: "original" | "reply" }.',
    });
    return true;
  }

  try {
    const beats = chooseDeskFork({ userId: user.id, forkChoice });
    send(req, res, 200, { ok: true, beats });
  } catch (err) {
    console.error("desk beats write failed:", err);
    send(req, res, 500, {
      error: "store_failed",
      message: "Failed to update desk beats",
    });
  }
  return true;
}
