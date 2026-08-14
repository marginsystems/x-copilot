/**
 * Stripe Checkout, Customer Portal, webhook, and GET /api/billing/me.
 * Missing Stripe env → 503 stripe_not_configured (API still boots).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import Stripe from "stripe";
import { frontendOrigin } from "./authConfig.js";
import {
  activateSubscription,
  cancelSubscriptionByStripeSubscriptionId,
  billingMePayload,
  ensureUserBillingRow,
  ensureUserTenant,
  getUserBilling,
  getUserBillingBySubscriptionId,
  persistStripeCustomerId,
  shouldApplyStripeEvent,
  updateSubscriptionFromStripe,
} from "./billingStore.js";
import { corsHeaders } from "./cors.js";
import { isPaidPlanKey, type PaidPlanKey } from "./plans.js";
import { getSessionUser } from "./sessionCookie.js";
import {
  planKeyFromStripePriceId,
  priceIdFromSubscription,
  resolveStripePriceId,
} from "./stripeConfig.js";
import {
  checkoutBlockedByExistingSubscription,
  portalBlockedForPureFreeUser,
  portalBlockedWithoutStripeSubscription,
} from "./stripeGuards.js";

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

class BodyError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

function readRawBody(req: IncomingMessage, max = 1_048_576): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        reject(new BodyError("Request body exceeds 1 MB limit", 413));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req);
  if (!raw.length) return {};
  try {
    const parsed: unknown = JSON.parse(raw.toString("utf8"));
    if (!parsed || typeof parsed !== "object") {
      throw new BodyError("Invalid JSON", 400);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof BodyError) throw err;
    throw new BodyError("Invalid JSON", 400);
  }
}

function stripeClient(): Stripe | null {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret) return null;
  return new Stripe(secret);
}

function stripeUnixToIso(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

function periodFieldsFromSubscription(subscription: Stripe.Subscription): {
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
} {
  const topLevel = (subscription as { current_period_end?: number })
    .current_period_end;
  const item = subscription.items?.data?.[0] as
    | { current_period_end?: number }
    | undefined;
  return {
    currentPeriodEnd: stripeUnixToIso(topLevel ?? item?.current_period_end),
    cancelAtPeriodEnd: Boolean(subscription.cancel_at_period_end),
  };
}

function notConfigured(req: IncomingMessage, res: ServerResponse): void {
  sendJson(req, res, 503, {
    error: "stripe_not_configured",
    message:
      "Stripe is not configured on this sidecar. Set STRIPE_SECRET_KEY and STRIPE_PRICE_PULSE / RADAR / HORIZON.",
  });
}

async function handleBillingMe(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const user = getSessionUser(req);
  if (!user) {
    sendJson(req, res, 401, { error: "unauthenticated" });
    return;
  }
  try {
    ensureUserTenant(user.id);
    const body = billingMePayload({ userId: user.id, email: user.email });
    sendJson(req, res, 200, { ok: true, ...body });
  } catch (err) {
    console.error("[GET /api/billing/me]", err);
    sendJson(req, res, 500, { error: "Failed to load billing" });
  }
}

async function handleCheckout(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const stripe = stripeClient();
  if (!stripe) {
    notConfigured(req, res);
    return;
  }
  const user = getSessionUser(req);
  if (!user) {
    sendJson(req, res, 401, { error: "unauthenticated" });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (err) {
    const status = err instanceof BodyError ? err.statusCode : 400;
    sendJson(req, res, status, { error: "bad_request" });
    return;
  }
  const planRaw = typeof body.plan === "string" ? body.plan.trim().toLowerCase() : "";
  if (!isPaidPlanKey(planRaw)) {
    sendJson(req, res, 400, {
      error: "bad_request",
      message: "plan must be pulse, radar, or horizon",
    });
    return;
  }
  const plan: PaidPlanKey = planRaw;
  const priceId = resolveStripePriceId(plan);
  if (!priceId) {
    sendJson(req, res, 503, {
      error: "stripe_not_configured",
      message: `Missing STRIPE_PRICE_${plan.toUpperCase()}`,
    });
    return;
  }

  const tenantId = ensureUserTenant(user.id);
  const row = ensureUserBillingRow(user.id, tenantId);
  const blocked = checkoutBlockedByExistingSubscription(row);
  if (blocked.blocked) {
    sendJson(req, res, 409, {
      error: "subscription_exists",
      subscription_status: blocked.subscription_status,
      message: blocked.message,
    });
    return;
  }

  let customerId = row.stripeCustomerId?.trim() || "";
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email?.trim() || undefined,
        metadata: { user_id: user.id, tenant_id: tenantId },
      });
      customerId = customer.id;
      persistStripeCustomerId(user.id, customerId);
    }
  } catch (err) {
    console.error("[POST /api/stripe/checkout] customer", err);
    sendJson(req, res, 502, {
      error: "stripe_customer_failed",
      message: "Could not create billing customer. Try again in a moment.",
    });
    return;
  }

  const frontend = frontendOrigin();
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${frontend}/usage?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontend}/usage?checkout=cancel`,
      client_reference_id: user.id,
      metadata: { user_id: user.id, plan_key: plan, tenant_id: tenantId },
      subscription_data: {
        metadata: { user_id: user.id, plan_key: plan, tenant_id: tenantId },
      },
      allow_promotion_codes: true,
    });
    if (!session.url) {
      sendJson(req, res, 500, { error: "stripe_checkout_failed" });
      return;
    }
    sendJson(req, res, 200, { ok: true, url: session.url });
  } catch (err) {
    console.error("[POST /api/stripe/checkout]", err);
    sendJson(req, res, 502, {
      error: "stripe_checkout_failed",
      message: "Could not start Checkout. Try again shortly.",
    });
  }
}

async function handlePortal(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const stripe = stripeClient();
  if (!stripe) {
    notConfigured(req, res);
    return;
  }
  const user = getSessionUser(req);
  if (!user) {
    sendJson(req, res, 401, { error: "unauthenticated" });
    return;
  }
  const tenantId = ensureUserTenant(user.id);
  const row = ensureUserBillingRow(user.id, tenantId);
  const freeBlock = portalBlockedForPureFreeUser(row);
  if (freeBlock.blocked) {
    sendJson(req, res, 400, {
      error: freeBlock.error,
      message: freeBlock.message,
    });
    return;
  }
  const subBlock = portalBlockedWithoutStripeSubscription(row);
  if (subBlock.blocked) {
    sendJson(req, res, 400, {
      error: subBlock.error,
      message: subBlock.message,
    });
    return;
  }
  const customerId = row.stripeCustomerId?.trim();
  if (!customerId) {
    sendJson(req, res, 400, {
      error: "no_billing_history",
      message: "No Stripe customer on file. Subscribe first.",
    });
    return;
  }
  const frontend = frontendOrigin();
  const portalConfig = process.env.STRIPE_PORTAL_CONFIGURATION_ID?.trim();
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${frontend}/usage`,
      ...(portalConfig ? { configuration: portalConfig } : {}),
    });
    if (!session.url) {
      sendJson(req, res, 500, { error: "stripe_portal_failed" });
      return;
    }
    sendJson(req, res, 200, { ok: true, url: session.url });
  } catch (err) {
    console.error("[POST /api/stripe/portal]", err);
    sendJson(req, res, 502, {
      error: "stripe_portal_failed",
      message:
        "Could not open the billing portal. Enable Customer Portal in the Stripe Dashboard (Settings → Billing → Customer portal).",
    });
  }
}

async function handleCheckoutConfirm(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const stripe = stripeClient();
  if (!stripe) {
    notConfigured(req, res);
    return;
  }
  const user = getSessionUser(req);
  if (!user) {
    sendJson(req, res, 401, { error: "unauthenticated" });
    return;
  }
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch (err) {
    const status = err instanceof BodyError ? err.statusCode : 400;
    sendJson(req, res, status, { error: "bad_request" });
    return;
  }
  const sessionId =
    typeof body.session_id === "string" ? body.session_id.trim() : "";
  if (!sessionId) {
    sendJson(req, res, 400, { error: "bad_request", message: "session_id required" });
    return;
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    console.error("[POST /api/stripe/checkout/confirm] retrieve", err);
    sendJson(req, res, 400, { error: "invalid_session" });
    return;
  }
  if (session.mode !== "subscription") {
    sendJson(req, res, 400, { error: "invalid_session" });
    return;
  }
  const sessionUserId =
    session.metadata?.user_id ?? session.client_reference_id ?? null;
  if (!sessionUserId || sessionUserId !== user.id) {
    sendJson(req, res, 403, { error: "forbidden" });
    return;
  }
  const planKey = session.metadata?.plan_key;
  if (!planKey || !isPaidPlanKey(planKey)) {
    sendJson(req, res, 400, { error: "invalid_session" });
    return;
  }
  const customerRaw = session.customer;
  const subscriptionRaw = session.subscription;
  const customerId =
    typeof customerRaw === "string" ? customerRaw : customerRaw?.id ?? null;
  const subscriptionId =
    typeof subscriptionRaw === "string"
      ? subscriptionRaw
      : subscriptionRaw?.id ?? null;
  if (!customerId || !subscriptionId) {
    sendJson(req, res, 409, { error: "not_provisioned" });
    return;
  }
  let subscription: Stripe.Subscription;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (err) {
    console.error("[POST /api/stripe/checkout/confirm] sub", err);
    sendJson(req, res, 409, { error: "not_provisioned" });
    return;
  }
  if (subscription.status !== "active" && subscription.status !== "trialing") {
    sendJson(req, res, 409, { error: "not_provisioned" });
    return;
  }
  const period = periodFieldsFromSubscription(subscription);
  activateSubscription({
    userId: user.id,
    planKey,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscriptionId,
    subscriptionStatus: subscription.status,
    currentPeriodEnd: period.currentPeriodEnd,
    cancelAtPeriodEnd: period.cancelAtPeriodEnd,
    stripeEventCreated: subscription.created,
  });
  sendJson(req, res, 200, { ok: true, plan_key: planKey });
}

async function dispatchWebhook(
  event: Stripe.Event,
  stripe: Stripe,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;
      const userId =
        session.metadata?.user_id ?? session.client_reference_id ?? undefined;
      const planKey = session.metadata?.plan_key;
      const customerRaw = session.customer;
      const subRaw = session.subscription;
      const customerId =
        typeof customerRaw === "string" ? customerRaw : customerRaw?.id ?? null;
      const subscriptionId =
        typeof subRaw === "string" ? subRaw : subRaw?.id ?? null;
      if (!userId || !planKey || !customerId || !subscriptionId) break;
      if (!isPaidPlanKey(planKey)) break;
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const period = periodFieldsFromSubscription(subscription);
      activateSubscription({
        userId,
        planKey,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        subscriptionStatus: subscription.status,
        currentPeriodEnd: period.currentPeriodEnd,
        cancelAtPeriodEnd: period.cancelAtPeriodEnd,
        stripeEventCreated: event.created,
      });
      break;
    }
    case "customer.subscription.updated": {
      const sub = event.data.object as Stripe.Subscription;
      const userId = sub.metadata?.user_id;
      const existing =
        getUserBillingBySubscriptionId(sub.id) ??
        (userId ? getUserBilling(userId) : null);
      const stored = existing?.stripeLastEventCreated ?? 0;
      if (!shouldApplyStripeEvent(stored, event.created)) break;
      const priceId = priceIdFromSubscription(sub);
      const planKey = planKeyFromStripePriceId(priceId);
      if (!planKey) {
        // Unknown price: keep the stored plan but surface the mismatch loudly
        // instead of silently granting the pricier tier (downgrade) or ignoring
        // an upgrade. The watermark still advances, so ops must fix STRIPE_PRICE_*
        // env and trigger a fresh event to reconcile.
        console.error(
          `[stripe-webhook] customer.subscription.updated ${sub.id}: price id ` +
            `'${priceId ?? "(none)"}' is not in STRIPE_PRICE_{PULSE,RADAR,HORIZON} — ` +
            `keeping stored plan '${existing?.planKey ?? "free"}'. Add the price to env ` +
            "and send a new subscription event to reconcile.",
        );
      }
      const customerRaw = sub.customer;
      const customerId =
        typeof customerRaw === "string" ? customerRaw : customerRaw?.id ?? null;
      const period = periodFieldsFromSubscription(sub);
      updateSubscriptionFromStripe({
        stripeSubscriptionId: sub.id,
        userId,
        status: sub.status,
        currentPeriodEnd: period.currentPeriodEnd,
        cancelAtPeriodEnd: period.cancelAtPeriodEnd,
        planKey,
        stripeCustomerId: customerId,
        stripeEventCreated: event.created,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      cancelSubscriptionByStripeSubscriptionId(sub.id, event.created);
      break;
    }
    default:
      break;
  }
  return { ok: true };
}

async function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const stripe = stripeClient();
  if (!stripe || !secret) {
    sendJson(req, res, 503, { error: "stripe_not_configured" });
    return;
  }
  let raw: Buffer;
  try {
    raw = await readRawBody(req);
  } catch (err) {
    const status = err instanceof BodyError ? err.statusCode : 400;
    sendJson(req, res, status, { error: "bad_request" });
    return;
  }
  const sig = req.headers["stripe-signature"];
  if (typeof sig !== "string" || !sig) {
    sendJson(req, res, 400, { error: "missing_signature" });
    return;
  }
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (err) {
    console.error("[POST /api/stripe/webhook] signature", err);
    sendJson(req, res, 400, { error: "invalid_signature" });
    return;
  }
  try {
    const result = await dispatchWebhook(event, stripe);
    if (!result.ok) {
      sendJson(req, res, result.status, { error: result.error });
      return;
    }
    sendJson(req, res, 200, { received: true });
  } catch (err) {
    console.error("[POST /api/stripe/webhook]", err);
    sendJson(req, res, 500, { error: "webhook_failed" });
  }
}

/** Public webhook only — call before the session gate. */
export async function tryHandleStripeWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "POST" && url.pathname === "/api/stripe/webhook") {
    await handleWebhook(req, res);
    return true;
  }
  return false;
}

/** Authenticated billing + checkout/portal. */
export async function tryHandleBilling(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/billing/me") {
    await handleBillingMe(req, res);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/stripe/checkout") {
    await handleCheckout(req, res);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/stripe/portal") {
    await handlePortal(req, res);
    return true;
  }
  if (req.method === "POST" && url.pathname === "/api/stripe/checkout/confirm") {
    await handleCheckoutConfirm(req, res);
    return true;
  }
  return false;
}
