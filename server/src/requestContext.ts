/**
 * Per-request tenant for the usage ledger (AsyncLocalStorage).
 * Falls back to the seeded local tenant when no session is present.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { getLocalTenantId } from "./db.js";

export type RequestContext = {
  tenantId: string;
  userId?: string;
};

const als = new AsyncLocalStorage<RequestContext>();

export function enterRequestContext(ctx: RequestContext): void {
  als.enterWith(ctx);
}

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T,
): T {
  return als.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return als.getStore();
}

export function getRequestTenantId(): string {
  return als.getStore()?.tenantId ?? getLocalTenantId();
}
