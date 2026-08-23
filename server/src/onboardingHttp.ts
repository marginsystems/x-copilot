/**
 * First-run onboarding HTTP: persist a chosen agenda.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { completeOnboarding, toPublicUser } from "./authStore.js";
import { userNeedsXHandle } from "./xIdentityStore.js";
import {
  BODY_CAP_1MB,
  BodyError,
  readBody,
  send,
} from "./httpJson.js";
import {
  generateOnboardingAgendas,
  validateAgendaText,
  validateOnboardingAnswers,
} from "./onboarding.js";
import { getSessionUser } from "./sessionCookie.js";
import { allowRate, clientIp } from "./authGuard.js";
import { beginVoiceCorpus } from "./userIngest.js";
import { VOICE_UNLOCK_MIN_POSTS } from "./voiceStore.js";

const ONBOARDING_GENERATE_RATE = { max: 20, windowMs: 10 * 60 * 1000 };
const ONBOARDING_COMPLETE_RATE = { max: 20, windowMs: 10 * 60 * 1000 };

async function readOnboardingBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  return (await readBody(req, {
    maxBytes: BODY_CAP_1MB,
    requireObject: true,
    rejectArray: true,
  })) as Record<string, unknown>;
}

/** Handle /api/onboarding/* — returns true if the request was consumed. */
export async function tryHandleOnboarding(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/onboarding")) return false;

  if (req.method === "POST" && url.pathname === "/api/onboarding/generate") {
    if (
      !allowRate(
        `onboarding-generate:${clientIp(req)}`,
        ONBOARDING_GENERATE_RATE.max,
        ONBOARDING_GENERATE_RATE.windowMs,
      )
    ) {
      send(req, res, 429, {
        error: "rate_limited",
        message: "Too many agenda generations",
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = await readOnboardingBody(req);
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }

    const parsed = validateOnboardingAnswers(body);
    if (!parsed.ok) {
      send(req, res, 400, { error: parsed.error, message: parsed.message });
      return true;
    }

    const result = await generateOnboardingAgendas(parsed.answers);
    send(req, res, 200, {
      ok: true,
      agendas: result.agendas,
      source: result.source,
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/onboarding/complete") {
    if (
      !allowRate(
        `onboarding-complete:${clientIp(req)}`,
        ONBOARDING_COMPLETE_RATE.max,
        ONBOARDING_COMPLETE_RATE.windowMs,
      )
    ) {
      send(req, res, 429, {
        error: "rate_limited",
        message: "Too many setup completions",
      });
      return true;
    }
    let body: Record<string, unknown>;
    try {
      body = await readOnboardingBody(req);
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      // Oversized body: the rest of the stream is still flowing. Destroy the
      // request after responding so leftover bytes are not parsed as the start
      // of a keep-alive connection's next request.
      if (statusCode === 413) req.destroy();
      return true;
    }

    const parsed = validateAgendaText(body.agenda);
    if (!parsed.ok) {
      send(req, res, 400, { error: parsed.error, message: parsed.message });
      return true;
    }

    const user = getSessionUser(req);
    if (!user) {
      send(req, res, 401, {
        ok: false,
        error: "unauthenticated",
        message: "Sign in required",
      });
      return true;
    }

    if (userNeedsXHandle(user)) {
      send(req, res, 400, {
        ok: false,
        error: "x_link_required",
        message: "Link X with the official X login to finish setup.",
      });
      return true;
    }

    const updated = completeOnboarding(user.id, parsed.agenda);
    if (!updated) {
      send(req, res, 404, {
        error: "not_found",
        message: "User not found.",
      });
      return true;
    }
    const ingest = await beginVoiceCorpus({
      user: updated,
      reason: "onboarding",
    });
    send(req, res, 200, {
      ok: true,
      persisted: true,
      user: toPublicUser(updated),
      ingest: ingest
        ? {
            conversationCount: ingest.conversationCount,
            unlockAt: VOICE_UNLOCK_MIN_POSTS,
            unlocked: ingest.unlocked,
            ok: ingest.ok,
            message: ingest.message ?? null,
          }
        : null,
    });
    return true;
  }

  send(req, res, 404, { error: "not_found" });
  return true;
}
