/**
 * Local sidecar — holds X API bearer + LLM keys off the browser.
 */
import http from "node:http";
import { resolve } from "node:path";
import { loadEnv } from "./platform/loadEnv.js";
import { getPlatformDb, getLocalTenantId } from "./db.js";
import { getXApiCredsFromEnv } from "./x-api/xApi.js";
import { tryHandleAuth } from "./auth/authHttp.js";
import { tryHandleAgenda } from "./desk/agendaHttp.js";
import { tryHandleOnboarding } from "./auth/onboardingHttp.js";
import { isOriginAllowed, requestOrigin } from "./http/cors.js";
import { authRequired, bindHost, isPublicApiPath } from "./auth/authGuard.js";
import { getSessionUser } from "./auth/sessionCookie.js";
import { tryHandleAdmin } from "./billing/adminHttp.js";
import { ensureUserTenant } from "./billing/billingStore.js";
import { runWithRequestContext } from "./http/requestContext.js";
import {
  tryHandleBilling,
  tryHandleStripeWebhook,
} from "./billing/stripeHttp.js";
import { tryHandleXActivityAuthed } from "./x-api/xActivityHttp.js";
import { tryHandleVoice } from "./voice/voiceHttp.js";
import { tryHandleForYou } from "./for-you/forYouHttp.js";
import { tryHandleCoaching } from "./desk/coachingHttp.js";
import { tryHandleDeskEvents, tryHandleDeskEventsWake, warnIfDeskEventsSecretMissing } from "./desk/deskEvents.js";
import { tryHandleDeskBeats } from "./desk/deskBeatsHttp.js";
import { tryHandleDigestEmail } from "./for-you/digestEmailHttp.js";
import { tryHandleMemory } from "./memory/memoryHttp.js";
import { tryHandleUsage } from "./billing/usageHttp.js";
import { tryHandleHistory } from "./desk/historyHttp.js";
import { tryHandleInteracted } from "./desk/interactedHttp.js";
import { tryHandleScout } from "./scout/scoutHttp.js";
import { tryHandleScoutProfile } from "./scout/scoutProfileHttp.js";
import { tryHandleBoot } from "./http/bootHttp.js";
import { tryHandleScoutApproachLock } from "./scout/scoutApproachLock.js";
import { resumeDueSubscriptions } from "./x-api/xActivitySubscribe.js";
import { send } from "./http/httpJson.js";

if (
  !loadEnv(resolve(process.cwd(), ".env"), {
    override: true,
    protected: ["NODE_ENV", "PORT", "XCOPILOT_ROLE"],
  })
) {
  console.error(
    "[api] .env not found — X_API_BEARER_TOKEN / DEEPSEEK_API_KEY required",
  );
  process.exit(1);
}

warnIfDeskEventsSecretMissing();

const PORT = Number(process.env.PORT || 8787);

try {
  getPlatformDb();
} catch (err) {
  console.error(
    "[db] platform migrate failed:",
    err instanceof Error ? err.message : String(err),
  );
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  try {
    if (req.method === "OPTIONS") {
      return send(req, res, 204, {});
    }

    if (await tryHandleAuth(req, res, url)) {
      return;
    }

    if (await tryHandleStripeWebhook(req, res, url)) {
      return;
    }

    if (await tryHandleDigestEmail(req, res, url)) {
      return;
    }

    if (await tryHandleDeskEventsWake(req, res, url)) return;

    if (authRequired() && !isPublicApiPath(url.pathname)) {
      if (
        !isOriginAllowed(
          typeof req.headers.origin === "string" ? req.headers.origin : undefined,
        )
      ) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
      if (!getSessionUser(req)) {
        return send(req, res, 401, {
          error: "unauthenticated",
          message: "Sign in required",
        });
      }
      // State-changing requests with a session must come from an allowed origin;
      // otherwise a cross-site fetch would ride the same-site-session cookie.
      if (
        (req.method === "POST" || req.method === "PUT") &&
        !isOriginAllowed(requestOrigin(req))
      ) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
    }

    if (tryHandleDeskEvents(req, res, url)) return;

    const sessionUser = getSessionUser(req);
    const tenantId = sessionUser
      ? ensureUserTenant(sessionUser.id)
      : getLocalTenantId();
    return runWithRequestContext(
      { tenantId, userId: sessionUser?.id },
      async () => {

      if (await tryHandleBoot(req, res, url)) {
        return;
      }
      if (await tryHandleBilling(req, res, url)) {
        return;
      }
      if (await tryHandleXActivityAuthed(req, res, url)) {
        return;
      }

      if (await tryHandleAdmin(req, res, url)) {
        return;
      }

      if (await tryHandleOnboarding(req, res, url)) {
        return;
      }

      if (await tryHandleAgenda(req, res, url)) {
        return;
      }

      if (await tryHandleVoice(req, res, url)) {
        return;
      }
      if (await tryHandleForYou(req, res, url)) {
        return;
      }
      if (await tryHandleCoaching(req, res, url)) {
        return;
      }
      if (await tryHandleDeskBeats(req, res, url)) {
        return;
      }
      if (await tryHandleMemory(req, res, url)) {
        return;
      }
      if (await tryHandleUsage(req, res, url)) {
        return;
      }
      if (await tryHandleHistory(req, res, url)) {
        return;
      }
      if (await tryHandleInteracted(req, res, url)) {
        return;
      }
      if (await tryHandleScoutApproachLock(req, res, url)) {
        return;
      }
      if (await tryHandleScoutProfile(req, res, url)) {
        return;
      }
      if (await tryHandleScout(req, res, url)) {
        return;
      }

      send(req, res, 404, { error: "not_found" });
      },
    );
  } catch (err) {
    console.error(err);
    send(req, res, 500, {
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((err: unknown) => {
    console.error(err);
    send(req, res, 500, {
      error: "internal_error",
      message: err instanceof Error ? err.message : String(err),
    });
  });
});

server.listen(PORT, bindHost(), () => {
  const xApi = getXApiCredsFromEnv();
  const host = bindHost();
  console.log(`x-copilot sidecar on http://${host}:${PORT}`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(
      "Public bind — put TLS in front (Cloudflare proxy).",
    );
  }
  console.log(
    xApi.configured
      ? "X API: bearer configured (run npm run test:x-api to verify)"
      : "X API: missing — set X_API_BEARER_TOKEN in .env",
  );
  void resumeDueSubscriptions().catch((err) => {
    console.warn("[xaa] resume subscriptions", err);
  });
});
