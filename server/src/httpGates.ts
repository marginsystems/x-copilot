/**
 * Shared 402 / 429 / 403 gate responses for the sidecar HTTP server.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  creditsExhaustedResponse,
  sortiesExhaustedResponse,
} from "./billingStore.js";
import { send } from "./httpJson.js";
import { getRequestContext, getRequestTenantId } from "./requestContext.js";
import { getSessionUser } from "./sessionCookie.js";
import { xLinkRequiredResponse } from "./xLinkGate.js";

export function sendCreditsExhausted(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const ctx = getRequestContext();
  const exhausted = creditsExhaustedResponse({
    userId: ctx?.userId,
    tenantId: ctx?.tenantId ?? getRequestTenantId(),
    email: getSessionUser(req)?.email,
  });
  if (!exhausted) return false;
  send(req, res, 402, exhausted);
  return true;
}

export function sendSortiesExhausted(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const ctx = getRequestContext();
  const exhausted = sortiesExhaustedResponse({
    userId: ctx?.userId,
    tenantId: ctx?.tenantId ?? getRequestTenantId(),
    email: getSessionUser(req)?.email,
  });
  if (!exhausted) return false;
  send(req, res, 429, exhausted);
  return true;
}

export function sendXLinkRequired(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  const blocked = xLinkRequiredResponse(getSessionUser(req));
  if (!blocked) return false;
  send(req, res, 403, blocked);
  return true;
}
