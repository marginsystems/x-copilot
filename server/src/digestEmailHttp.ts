/**
 * Authenticated digest preference plus public signed unsubscribe.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { allowRate, clientIp } from "./authGuard.js";
import {
  getDigestEmailSettings,
  setDigestEmailOptIn,
} from "./digestEmailStore.js";
import { isOriginAllowed, requestOrigin } from "./cors.js";
import {
  BODY_CAP_16K,
  BodyError,
  readBody,
  send,
} from "./httpJson.js";
import { verifyUnsubscribeToken } from "./mail.js";
import { getRequestSession } from "./sessionCookie.js";

const PREFERENCE_RATE = { max: 20, windowMs: 10 * 60 * 1000 };
const UNSUBSCRIBE_RATE = { max: 60, windowMs: 10 * 60 * 1000 };

function sendUnsubscribePage(res: ServerResponse, ok: boolean): void {
  const title = ok ? "Approach email is off" : "Unsubscribe link is invalid";
  const detail = ok
    ? "You will no longer receive the x-copilot Approach digest."
    : "This link is invalid or expired. You can update email preferences in your x-copilot account.";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body><main><h1>${title}</h1><p>${detail}</p><p><a href="https://xcopilot.dev/dashboard">Open x-copilot</a></p><p>Built by Mergestorm, Inc.</p></main></body></html>`;
  res.writeHead(ok ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

function publicPreference(userId: string) {
  const settings = getDigestEmailSettings(userId);
  return {
    digestEmailOptIn: settings?.optedIn ?? false,
    digestEmailAvailable: Boolean(settings?.email),
  };
}

/** Returns true when an /api/mail route was consumed. */
export async function tryHandleDigestEmail(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/mail/")) return false;

  if (
    (req.method === "GET" || req.method === "POST") &&
    url.pathname === "/api/mail/unsubscribe"
  ) {
    const token = url.searchParams.get("t") ?? "";
    if (
      !allowRate(
        `mail-unsubscribe:${clientIp(req)}`,
        UNSUBSCRIBE_RATE.max,
        UNSUBSCRIBE_RATE.windowMs,
      )
    ) {
      send(req, res, 429, { error: "rate_limited" });
      return true;
    }
    const userId = verifyUnsubscribeToken(token);
    const updated = userId ? setDigestEmailOptIn(userId, false) : null;
    if (req.method === "POST") {
      send(req, res, updated ? 204 : 400, updated ? {} : { error: "invalid_token" });
    } else {
      sendUnsubscribePage(res, Boolean(updated));
    }
    return true;
  }

  if (req.method === "PATCH" && url.pathname === "/api/mail/preferences") {
    if (!isOriginAllowed(requestOrigin(req))) {
      send(req, res, 403, { error: "forbidden", message: "Origin not allowed" });
      return true;
    }
    const session = getRequestSession(req);
    if (!session) {
      send(req, res, 401, { error: "unauthenticated" });
      return true;
    }
    if (
      !allowRate(
        `mail-preference:${session.user.id}`,
        PREFERENCE_RATE.max,
        PREFERENCE_RATE.windowMs,
      )
    ) {
      send(req, res, 429, { error: "rate_limited" });
      return true;
    }
    try {
      const body = (await readBody(req, {
        maxBytes: BODY_CAP_16K,
        requireObject: true,
        rejectArray: true,
      })) as Record<string, unknown>;
      if (typeof body.digestEmailOptIn !== "boolean") {
        send(req, res, 400, {
          error: "invalid_preference",
          message: "digestEmailOptIn must be boolean",
        });
        return true;
      }
      const settings = setDigestEmailOptIn(
        session.user.id,
        body.digestEmailOptIn,
      );
      if (!settings) {
        send(req, res, 409, {
          error: "verified_email_required",
          message: "Link Google to add a verified email before opting in.",
        });
        return true;
      }
      send(req, res, 200, {
        ok: true,
        ...publicPreference(session.user.id),
      });
    } catch (err) {
      if (err instanceof BodyError) {
        send(req, res, err.statusCode, {
          error: "invalid_json",
          message: err.message,
        });
      } else {
        throw err;
      }
    }
    return true;
  }

  send(req, res, 404, { error: "not_found" });
  return true;
}

export { publicPreference as digestEmailPreferencePayload };
