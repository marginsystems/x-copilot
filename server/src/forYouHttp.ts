/** For You suggestion inbox — list + I posted / Skip / Not interested. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { allowRate } from "./authGuard.js";
import { ensureUserBillingRow, ensureUserTenant } from "./billingStore.js";
import { deepseekConfigured } from "./deepseek.js";
import {
  getDeskBeats,
  recordDeskOriginalPosted,
  recordDeskReplyMarked,
} from "./deskBeats.js";
import { confirmRecentOwnPosts } from "./userIngest.js";
import {
  buildForYouDigest,
  countT24hSnapshots,
  MIN_T24H_SNAPSHOTS,
} from "./forYouDigest.js";
import { getExtraUsage } from "./forYouExtra.js";
import { draftForYouScoutOriginal } from "./forYouLlm.js";
import {
  insertSuggestions,
  listActiveSuggestions,
  markSuggestion,
} from "./forYouStore.js";
import type { ForYouSuggestion } from "./forYouStore.js";
import { BODY_CAP_256K, readJsonBody, send } from "./httpJson.js";
import { resolvePlan } from "./planResolution.js";
import { getSessionUser } from "./sessionCookie.js";
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
      url.pathname === "/api/for-you/done"
        ? "done"
        : url.pathname === "/api/for-you/dismiss"
          ? "dismissed"
          : "skipped";
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
    if (status === "done") {
      const nowMs = suggestion.actedAt
        ? Date.parse(suggestion.actedAt) || Date.now()
        : Date.now();
      if (
        suggestion.kind === "reply" ||
        suggestion.kind === "quote" ||
        suggestion.kind === "repost"
      ) {
        if (
          suggestion.kind === "reply" ||
          getDeskBeats({ userId: user.id, nowMs }).forkChoice !== "reply"
        ) {
          try {
            recordDeskReplyMarked({
              userId: user.id,
              source: "organic",
              nowMs,
            });
          } catch (err) {
            console.warn("desk beats For You reply soft-fail:", err);
          }
        }
      }
      if (suggestion.kind === "post") {
        try {
          recordDeskOriginalPosted({ userId: user.id, nowMs });
        } catch (err) {
          console.warn("desk beats For You original soft-fail:", err);
        }
        if (getDeskBeats({ userId: user.id, nowMs }).forkChoice !== "reply") {
          try {
            recordDeskReplyMarked({
              userId: user.id,
              source: "organic",
              nowMs,
            });
          } catch (err) {
            console.warn("desk beats For You original organic soft-fail:", err);
          }
        }
      }
      void confirmRecentOwnPosts({ userId: user.id }).catch((err) => {
        console.warn("own-post confirm after I posted soft-fail:", err);
      });
    }
    let replacement: ForYouSuggestion | null = null;
    if (status === "skipped") {
      replacement = await refillScoutOriginal({
        userId: user.id,
        tenantId,
        chat: opts?.chat,
      });
    }
    send(req, res, 200, {
      ok: true,
      suggestion,
      replacement,
      suggestions: listActiveSuggestions(user.id),
    });
    return true;
  }

  send(req, res, 404, { error: "not_found" });
  return true;
}

async function refillScoutOriginal(opts: {
  userId: string;
  tenantId: string;
  chat?: ChatFn;
}): Promise<ForYouSuggestion | null> {
  if (listActiveSuggestions(opts.userId).some((row) => row.kind === "post")) {
    return null;
  }
  if (!opts.chat && !deepseekConfigured()) return null;
  if (!allowRate(`for-you-refill:${opts.userId}`, 8, 60 * 60 * 1000)) {
    return null;
  }
  const digest = await buildForYouDigest({ userId: opts.userId });
  if (digest.leftoverScout.length === 0 && !digest.agenda) return null;
  const result = await draftForYouScoutOriginal({
    digest,
    chat: opts.chat,
  });
  if (!result.ok || !result.drafts[0]) return null;
  const rows = insertSuggestions({
    userId: opts.userId,
    tenantId: opts.tenantId,
    drafts: result.drafts.slice(0, 1),
  });
  return rows[0] ?? null;
}
