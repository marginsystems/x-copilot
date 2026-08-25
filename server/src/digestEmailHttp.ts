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

function sendUnsubscribePage(
  res: ServerResponse,
  userId: string | null,
  token: string,
): void {
  const valid = Boolean(userId);
  const title = valid
    ? "Unsubscribe from Approach email?"
    : "Unsubscribe link is invalid";
  const detail = valid
    ? "Confirm below to stop the x-copilot Approach digest."
    : "This link is invalid or no longer valid. You can update email preferences in your x-copilot account.";
  const action = `/api/mail/unsubscribe?t=${encodeURIComponent(token)}`;
  const confirmation = valid
    ? `<form method="post" action="${action}"><button type="submit">Turn off Approach email</button></form>`
    : "";
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body><main><h1>${title}</h1><p>${detail}</p>${confirmation}<p><a href="https://xcopilot.dev/dashboard">Open x-copilot</a></p><p>Built by Mergestorm, Inc.</p></main></body></html>`;
  res.writeHead(valid ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(html);
}

function sendUnsubscribedPage(res: ServerResponse): void {
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Approach email is off</title><body><main><h1>Approach email is off</h1><p>You will no longer receive the x-copilot Approach digest.</p><p><a href="https://xcopilot.dev/dashboard">Open x-copilot</a></p><p>Built by Mergestorm, Inc.</p></main></body></html>`;
  res.writeHead(200, {
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
    if (req.method === "POST") {
      const updated = userId ? setDigestEmailOptIn(userId, false) : null;
      if (updated) {
        sendUnsubscribedPage(res);
      } else {
        send(req, res, 400, { error: "invalid_token" });
      }
    } else {
      sendUnsubscribePage(res, userId, token);
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
