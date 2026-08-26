/**
 * For You suggestion inbox — list + I posted / Skip / Not interested
 * + credit-backed extra originals.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { allowRate } from "./authGuard.js";
import {
  creditsExhaustedResponse,
  getCreditUsage,
} from "./billingQuotas.js";
import { ensureUserBillingRow, ensureUserTenant } from "./billingStore.js";
import { deepseekConfigured } from "./deepseek.js";
import {
  buildForYouDigest,
  countT24hSnapshots,
  MIN_T24H_SNAPSHOTS,
} from "./forYouDigest.js";
import {
  extraCapMessage,
  FOR_YOU_EXTRA_CREDIT_COST,
  FOR_YOU_EXTRA_USAGE_PATH,
  getExtraUsage,
  removeExtraRecord,
  reserveExtraSlot,
} from "./forYouExtra.js";
import { draftForYouExtraPosts } from "./forYouLlm.js";
import {
  insertSuggestions,
  listActiveSuggestions,
  markSuggestion,
} from "./forYouStore.js";
import { BODY_CAP_256K, readJsonBody, send } from "./httpJson.js";
import { resolvePlan } from "./planResolution.js";
import { getSessionUser } from "./sessionCookie.js";
import { recordUsageEvent } from "./usageMeter.js";
import type { ChatFn } from "./voiceLlm.js";

export async function tryHandleForYou(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  opts?: { chat?: ChatFn },
): Promise<boolean> {
  if (!url.pathname.startsWith("/api/for-you")) return false;

  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, {
      error: "unauthenticated",
      message: "Sign in required",
    });
    return true;
  }

  const tenantId = ensureUserTenant(user.id);
  const billing = ensureUserBillingRow(user.id, tenantId);
  const planKey = resolvePlan(billing, user.email).planKey;

  if (req.method === "GET" && url.pathname === "/api/for-you") {
    const suggestions = listActiveSuggestions(user.id);
    send(req, res, 200, {
      ok: true,
      suggestions,
      tracked: countT24hSnapshots(user.id),
      needed: MIN_T24H_SNAPSHOTS,
      extra: getExtraUsage({ userId: user.id, tenantId, planKey }),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/for-you/extra") {
    await handleForYouExtra(req, res, {
      userId: user.id,
      tenantId,
      email: user.email,
      planKey,
      chat: opts?.chat,
    });
    return true;
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/api/for-you/done" ||
      url.pathname === "/api/for-you/skip" ||
      url.pathname === "/api/for-you/dismiss")
  ) {
    const body = await readJsonBody(req, { maxBytes: BODY_CAP_256K });
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) {
      send(req, res, 400, { error: "bad_request", message: "id required" });
      return true;
    }
    const status =
      url.pathname === "/api/for-you/done" ? "done" : "skipped";
    const suggestion = markSuggestion({
      id,
      userId: user.id,
      status,
    });
    if (!suggestion) {
      send(req, res, 404, {
        error: "not_found",
        message: "Suggestion is gone or already acted on.",
      });
      return true;
    }
    send(req, res, 200, { ok: true, suggestion });
    return true;
  }

  send(req, res, 404, { error: "not_found" });
  return true;
}

async function handleForYouExtra(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    userId: string;
    tenantId: string;
    email: string | null;
    planKey: ReturnType<typeof resolvePlan>["planKey"];
    chat?: ChatFn;
  },
): Promise<void> {
  if (!allowRate(`for-you-extra:${opts.userId}`, 20, 60_000)) {
    send(req, res, 429, {
      error: "rate_limited",
      message: "Too many extra batches — slow down a moment.",
    });
    return;
  }

  if (countT24hSnapshots(opts.userId) < MIN_T24H_SNAPSHOTS) {
    send(req, res, 409, {
      error: "extra_not_ready",
      message: `Extra originals unlock after ${MIN_T24H_SNAPSHOTS} posts with 24h stats.`,
    });
    return;
  }

  if (!opts.chat && !deepseekConfigured()) {
    send(req, res, 503, {
      error: "no_llm",
      message: "Approach extras are offline right now.",
    });
    return;
  }

  const exhausted = creditsExhaustedResponse({
    userId: opts.userId,
    tenantId: opts.tenantId,
    email: opts.email,
  });
  const credits = getCreditUsage(opts.tenantId, opts.planKey);
  if (exhausted || credits.remaining < FOR_YOU_EXTRA_CREDIT_COST) {
    send(req, res, 402, {
      error: "credits_exhausted",
      message:
        exhausted?.message ??
        `Three more originals cost ${FOR_YOU_EXTRA_CREDIT_COST} credits. Open Usage & Billing.`,
      used: credits.used,
      limit: credits.limit,
      planKey: opts.planKey,
    });
    return;
  }

  const reservationId = reserveExtraSlot(opts.userId, opts.tenantId);
  if (!reservationId) {
    const extra = getExtraUsage({
      userId: opts.userId,
      tenantId: opts.tenantId,
      planKey: opts.planKey,
    });
    send(req, res, 429, {
      error: "extra_daily_limit",
      message: extraCapMessage(extra.used, extra.limit),
      used: extra.used,
      limit: extra.limit,
    });
    return;
  }

  const digest = await buildForYouDigest({ userId: opts.userId });
  const result = await draftForYouExtraPosts({
    digest,
    chat: opts.chat,
  });
  if (!result.ok || result.drafts.length < 3) {
    removeExtraRecord(reservationId);
    send(req, res, 502, {
      error: result.ok ? "empty" : "llm_error",
      message: result.ok
        ? "Could not draft three originals. Try again in a moment."
        : result.error,
    });
    return;
  }

  const suggestions = insertSuggestions({
    userId: opts.userId,
    tenantId: opts.tenantId,
    drafts: result.drafts.slice(0, 3),
  });
  recordUsageEvent({
    tenantId: opts.tenantId,
    method: "POST",
    path: FOR_YOU_EXTRA_USAGE_PATH,
    status: 200,
    postsRead: FOR_YOU_EXTRA_CREDIT_COST,
    meta: { batch: suggestions.length },
  });
  send(req, res, 200, {
    ok: true,
    suggestions,
    extra: getExtraUsage({
      userId: opts.userId,
      tenantId: opts.tenantId,
      planKey: opts.planKey,
    }),
  });
}
