/**
 * Health, usage, and gamification JSON routes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ensureUserBillingRow } from "./billingStore.js";
import {
  creditLimitForPlan,
  effectivePlanKey,
} from "./planResolution.js";
import { getGamification } from "./gamification.js";
import { send } from "./httpJson.js";
import { memoryIndexStatus } from "./memoryIndex.js";
import { PLAN_CREDIT_LIMITS } from "./plans.js";
import { getRequestTenantId } from "./requestContext.js";
import { getSessionUser } from "./sessionCookie.js";
import { getUsageSummary, toTenantUsageView } from "./usageMeter.js";
import { getXApiCredsFromEnv } from "./xApi.js";

export async function tryHandleUsage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (
    req.method === "GET" &&
    (url.pathname === "/api/health" || url.pathname === "/health")
  ) {
    const xApi = getXApiCredsFromEnv();
    const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
    const memory = await memoryIndexStatus();
    send(req, res, 200, {
      ok: true,
      xApiConfigured: xApi.configured,
      deepseekConfigured: hasDeepseek,
      memoryIndex: {
        dbExists: memory.dbExists,
        modelCached: memory.modelCached,
        modelError: memory.modelError,
      },
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/usage") {
    const windowRaw = (url.searchParams.get("window") || "7d").toLowerCase();
    const window =
      windowRaw === "24h" || windowRaw === "all" || windowRaw === "7d"
        ? windowRaw
        : "7d";
    try {
      const user = getSessionUser(req);
      const tenantId = getRequestTenantId();
      let creditLimit = PLAN_CREDIT_LIMITS.free;
      if (user) {
        const row = ensureUserBillingRow(user.id, tenantId);
        creditLimit = creditLimitForPlan(
          effectivePlanKey(row, user.email),
        );
      }
      const summary = getUsageSummary({ window, creditLimit });
      send(req, res, 200, {
        ok: true,
        ...toTenantUsageView(summary),
      });
      return true;
    } catch (err) {
      send(req, res, 500, {
        error: "usage_unavailable",
        message: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/gamification") {
    try {
      send(
        req,
        res,
        200,
        await getGamification({ userId: getSessionUser(req)?.id }),
      );
      return true;
    } catch (err) {
      console.error("gamification read failed:", err);
      send(req, res, 500, {
        error: "store_failed",
        message: "Failed to load gamification",
      });
      return true;
    }
  }

  return false;
}
