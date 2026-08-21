/**
 * Local sidecar — holds X API bearer + LLM keys off the browser.
 */
import http from "node:http";
import { resolve } from "node:path";
import { loadEnv } from "./loadEnv.js";
import { getPlatformDb, getLocalTenantId } from "./db.js";
import { getXApiCredsFromEnv } from "./xApi.js";
import { tryHandleAuth } from "./authHttp.js";
import { tryHandleOnboarding } from "./onboardingHttp.js";
import { isOriginAllowed, requestOrigin } from "./cors.js";
import { authRequired, bindHost, isPublicApiPath } from "./authGuard.js";
import { getSessionUser } from "./sessionCookie.js";
import { tryHandleAdmin } from "./adminHttp.js";
import { ensureUserTenant } from "./billingStore.js";
import { runWithRequestContext } from "./requestContext.js";
import {
  tryHandleBilling,
  tryHandleStripeWebhook,
} from "./stripeHttp.js";
import {
  tryHandleXActivityAuthed,
  tryHandleXActivityWebhook,
} from "./xActivityHttp.js";
import { tryHandleVoice } from "./voiceHttp.js";
import { tryHandleForYou } from "./forYouHttp.js";
import { tryHandleMemory } from "./memoryHttp.js";
import { tryHandleUsage } from "./usageHttp.js";
import { tryHandleHistory } from "./historyHttp.js";
import { tryHandleInteracted } from "./interactedHttp.js";
import { tryHandleScout } from "./scoutHttp.js";
import { resumeDueSubscriptions } from "./xActivitySubscribe.js";
import { send } from "./httpJson.js";

if (
  !loadEnv(resolve(process.cwd(), ".env"), {
    override: true,
    protected: ["NODE_ENV", "PORT"],
  })
) {
  console.error(
    "[api] .env not found — X_API_BEARER_TOKEN / DEEPSEEK_API_KEY required",
  );
  process.exit(1);
}

const PORT = Number(process.env.PORT || 8787);

try {
  getPlatformDb();
} catch (err) {
  console.error(
    "[db] platform migrate failed:",
    err instanceof Error ? err.message : String(err),
  );
}

const server = http.createServer(async (req, res) => {
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

    if (await tryHandleXActivityWebhook(req, res, url)) {
      return;
    }

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
      if (req.method === "POST" && !isOriginAllowed(requestOrigin(req))) {
        return send(req, res, 403, {
          error: "forbidden",
          message: "Origin not allowed",
        });
      }
    }

    const sessionUser = getSessionUser(req);
    const tenantId = sessionUser
      ? ensureUserTenant(sessionUser.id)
      : getLocalTenantId();
    return runWithRequestContext(
      { tenantId, userId: sessionUser?.id },
      async () => {

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

      if (await tryHandleVoice(req, res, url)) {
        return;
      }
      if (await tryHandleForYou(req, res, url)) {
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
});

server.listen(PORT, bindHost(), () => {
  const xApi = getXApiCredsFromEnv();
  const host = bindHost();
  console.log(`x-copilot sidecar on http://${host}:${PORT}`);
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.log(
      "Public bind — put TLS in front (Cloudflare proxy). See docs/PUBLIC_DEPLOY.md",
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
