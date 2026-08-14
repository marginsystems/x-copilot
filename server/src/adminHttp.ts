/**
 * Operator /admin API — per-tenant usage this UTC month + full request logs.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAdminEmail } from "./adminEmails.js";
import { listAdminTenantUsage } from "./billingStore.js";
import { corsHeaders } from "./cors.js";
import { getSessionUser } from "./sessionCookie.js";
import { getUsageSummary } from "./usageMeter.js";

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

  sendJson(req, res, 404, { error: "not_found" });
  return true;
}
