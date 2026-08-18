/**
 * Operator /admin API — per-tenant usage this UTC month + full request logs
 * and complimentary plan grants.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAdminEmail } from "./adminEmails.js";
import {
  activeManualGrant,
  billingMePayload,
  grantManualPlan,
  listAdminTenantUsage,
  liveSubTakesPrecedence,
} from "./billingStore.js";
import {
  findUserIdByXUsername,
  getUserByEmail,
  getUserById,
  getXOauthUsername,
} from "./authStore.js";
import { corsHeaders, isOriginAllowed, requestOrigin } from "./cors.js";
import { getSessionUser } from "./sessionCookie.js";
import { isPaidPlanKey, isPlanKey } from "./plans.js";
import { getUsageSummary } from "./usageMeter.js";
import { allowRate } from "./authGuard.js";

function sendJson(
  req: IncomingMessage,
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.writeHead(status, {
    "Content-Type": "application/json",
    ...corsHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function requireOrigin(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = requestOrigin(req);
  if (origin && isOriginAllowed(origin)) return true;
  sendJson(req, res, 403, {
    error: "forbidden",
    message: "Origin not allowed",
  });
  return false;
}

class BodyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 16_384) {
        reject(new BodyError("Request body exceeds 16 KiB limit", 413));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
          resolve(null);
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

function resolveGrantUser(body: Record<string, unknown>) {
  const userId =
    typeof body.userId === "string" ? body.userId.trim() : "";
  if (userId) return getUserById(userId);
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (email) return getUserByEmail(email);
  const handle =
    typeof body.handle === "string"
      ? body.handle
      : typeof body.username === "string"
        ? body.username
        : "";
  if (handle.trim()) {
    const id = findUserIdByXUsername(handle);
    return id ? getUserById(id) : null;
  }
  return null;
}

export async function tryHandleAdmin(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/admin")) return false;

  const user = getSessionUser(req);
  if (!user) {
    sendJson(req, res, 401, { error: "unauthenticated" });
    return true;
  }
  if (!isAdminEmail(user.email)) {
    sendJson(req, res, 403, {
      error: "forbidden",
      message: "Admin only",
    });
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/admin/tenants") {
    try {
      const tenants = listAdminTenantUsage();
      sendJson(req, res, 200, {
        ok: true,
        window: "utc_month",
        tenants,
      });
    } catch (err) {
      console.error("[GET /api/admin/tenants]", err);
      sendJson(req, res, 500, { error: "admin_unavailable" });
    }
    return true;
  }

  const tenantUsage = url.pathname.match(
    /^\/api\/admin\/tenants\/([^/]+)\/usage$/,
  );
  if (req.method === "GET" && tenantUsage) {
    const windowRaw = (url.searchParams.get("window") || "7d").toLowerCase();
    const window =
      windowRaw === "24h" || windowRaw === "all" || windowRaw === "7d"
        ? windowRaw
        : "7d";
    try {
      let tenantId: string;
      try {
        tenantId = decodeURIComponent(tenantUsage[1] ?? "");
      } catch {
        sendJson(req, res, 400, { error: "invalid_tenant_id" });
        return true;
      }
      const tenant = listAdminTenantUsage().find((t) => t.tenantId === tenantId);
      if (!tenant) {
        sendJson(req, res, 404, { error: "not_found" });
        return true;
      }
      const summary = getUsageSummary({
        tenantId,
        window,
        creditLimit: tenant.creditLimit,
        limit: 200,
      });
      sendJson(req, res, 200, {
        ok: true,
        tenant,
        ...summary,
      });
    } catch (err) {
      console.error("[GET /api/admin/tenants/:id/usage]", err);
      sendJson(req, res, 500, { error: "admin_unavailable" });
    }
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/admin/grants") {
    if (!requireOrigin(req, res)) return true;
    if (!allowRate(`admin-grant:${user.id}`, 20, 60_000)) {
      sendJson(req, res, 429, {
        error: "rate_limited",
        message: "Too many grant attempts — slow down a moment.",
      });
      return true;
    }
    let body: Record<string, unknown> | null;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      sendJson(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      // Oversized body: the rest of the stream is still flowing. Destroy the
      // request after responding so leftover bytes are not parsed as the start
      // of a keep-alive connection's next request.
      if (statusCode === 413) req.destroy();
      return true;
    }
    if (!body) {
      sendJson(req, res, 400, {
        error: "invalid_json",
        message: "Invalid JSON body.",
      });
      return true;
    }
    const planRaw = typeof body.plan === "string" ? body.plan.trim() : "";
    if (!isPlanKey(planRaw) || (planRaw !== "free" && !isPaidPlanKey(planRaw))) {
      sendJson(req, res, 400, {
        error: "bad_plan",
        message: "Pass plan: pulse, radar, horizon, or free.",
      });
      return true;
    }
    const target = resolveGrantUser(body);
    if (!target) {
      sendJson(req, res, 404, {
        error: "user_not_found",
        message: "No user matches that handle, email, or id.",
      });
      return true;
    }
    const row = grantManualPlan({
      userId: target.id,
      planKey: planRaw === "free" ? "free" : planRaw,
      grantedBy: user.email ?? user.id,
    });
    const me = billingMePayload({ userId: target.id, email: target.email });
    const grant = activeManualGrant(row, target.email);
    const planKey = String(me.plan_key);
    const hasLiveSub = liveSubTakesPrecedence(row);
    let notice = grant?.notice;
    if (notice === undefined) {
      if (planRaw === "free") {
        notice =
          planKey === "free"
            ? "Manual grant cleared. This account is back on Free."
            : hasLiveSub
              ? "Manual grant cleared, but this account still runs on its live Stripe subscription."
              : `Manual grant cleared; this account still runs on ${planKey}.`;
      } else if (row.grantPlanKey !== null) {
        notice = hasLiveSub
          ? `Manual grant for ${row.grantPlanKey} is stored; this account's live Stripe subscription (${planKey}) takes precedence until it ends.`
          : `Manual grant for ${row.grantPlanKey} is stored; admin accounts always run on ${planKey}.`;
      }
    }
    sendJson(req, res, 200, {
      ok: true,
      user: {
        id: target.id,
        email: target.email,
        xUsername: getXOauthUsername(target.id),
      },
      grant,
      plan_key: planKey,
      notice,
    });
    return true;
  }

  sendJson(req, res, 404, { error: "not_found" });
  return true;
}
