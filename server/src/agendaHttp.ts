/**
 * Live desk agenda: PUT /api/agenda writes users.agenda.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { toPublicUser, updateUserAgenda } from "./authStore.js";
import { allowRate, clientIp } from "./authGuard.js";
import { isOriginAllowed, requestOrigin } from "./cors.js";
import {
  BODY_CAP_16K,
  BodyError,
  readBody,
  send,
} from "./httpJson.js";
import { validateAgendaText } from "./onboarding.js";
import { getSessionUser } from "./sessionCookie.js";

const AGENDA_PUT_RATE = { max: 40, windowMs: 10 * 60 * 1000 };

/** Handle PUT /api/agenda — returns true if the request was consumed. */
export async function tryHandleAgenda(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/agenda") return false;

  if (req.method !== "PUT") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }

  if (!isOriginAllowed(requestOrigin(req))) {
    send(req, res, 403, {
      error: "forbidden",
      message: "Origin not allowed",
    });
    return true;
  }

  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, {
      error: "unauthenticated",
      message: "Sign in required",
    });
    return true;
  }

  if (
    !allowRate(
      `agenda-put:${user.id}:${clientIp(req)}`,
      AGENDA_PUT_RATE.max,
      AGENDA_PUT_RATE.windowMs,
    )
  ) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many agenda saves",
    });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = (await readBody(req, {
      maxBytes: BODY_CAP_16K,
      requireObject: true,
      rejectArray: true,
    })) as Record<string, unknown>;
  } catch (err) {
    const statusCode = err instanceof BodyError ? err.statusCode : 400;
    send(req, res, statusCode, {
      error: "bad_request",
      message: err instanceof Error ? err.message : "Invalid request body",
    });
    if (statusCode === 413) req.destroy();
    return true;
  }

  const parsed = validateAgendaText(body.agenda);
  if (!parsed.ok) {
    send(req, res, 400, { error: parsed.error, message: parsed.message });
    return true;
  }

  const updated = updateUserAgenda(user.id, parsed.agenda);
  if (!updated) {
    send(req, res, 404, {
      error: "not_found",
      message: "User not found.",
    });
    return true;
  }

  send(req, res, 200, { ok: true, user: toPublicUser(updated) });
  return true;
}
