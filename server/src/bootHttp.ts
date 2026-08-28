/**
 * GET /api/boot — one first-paint payload for the desk.
 * Cheap store reads in parallel. No live X metrics, no DeepSeek.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { bucketInteractions } from "./activityStats.js";
import { isAdminEmail } from "./adminEmails.js";
import { toPublicUser } from "./authStore.js";
import { authRequired } from "./authGuard.js";
import {
  ensureUserBillingRow,
  ensureUserTenant,
} from "./billingStore.js";
import {
  buildCoachingSnapshot,
} from "./coachingSnapshot.js";
import { listMissionsWithProgress } from "./dailyMissions.js";
import { listDismissalHistory } from "./dismissalStore.js";
import { listExpiredHistory } from "./expiredStore.js";
import { countT24hSnapshots, MIN_T24H_SNAPSHOTS } from "./forYouDigest.js";
import { getExtraUsage } from "./forYouExtra.js";
import { listActiveSuggestions } from "./forYouStore.js";
import { getGamification } from "./gamification.js";
import { send } from "./httpJson.js";
import {
  listActiveInteractions,
  listInteractionHistory,
  MAX_INTERACTION_HISTORY,
  MAX_INTERACTION_STORE,
} from "./interactionStore.js";
import { resolvePlan } from "./planResolution.js";
import { getRequestTenantId } from "./requestContext.js";
import { readLastScoutPayload } from "./scoutHttp.js";
import { getScoutLog } from "./scoutLog.js";
import { getSessionUser } from "./sessionCookie.js";
import { listSkipHistory } from "./skipStore.js";

const NO_STORE = { "Cache-Control": "no-store" };

function publicUser(user: NonNullable<ReturnType<typeof getSessionUser>>) {
  return {
    ...toPublicUser(user),
    isAdmin: isAdminEmail(user.email),
  };
}

export async function tryHandleBoot(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/boot") return false;
  if (req.method !== "GET") return false;

  const required = authRequired();
  const user = getSessionUser(req);
  if (!user && required) {
    send(
      req,
      res,
      401,
      { ok: false, error: "unauthenticated", authRequired: required },
      NO_STORE,
    );
    return true;
  }

  const dedupeParam = url.searchParams.get("dedupeAccounts");
  const tenantId = user ? ensureUserTenant(user.id) : getRequestTenantId();

  try {
    const [
      dismissals,
      skipped,
      expired,
      interactionHistory,
      active,
      lastScout,
      scoutLog,
      gamification,
    ] = await Promise.all([
      listDismissalHistory(),
      listSkipHistory(),
      listExpiredHistory(),
      listInteractionHistory({ limit: MAX_INTERACTION_STORE }),
      listActiveInteractions(),
      readLastScoutPayload({
        dedupeAccounts:
          dedupeParam === null ? null : dedupeParam !== "false",
      }),
      getScoutLog(),
      getGamification({ userId: user?.id }),
    ]);

    const interactions = interactionHistory.slice(0, MAX_INTERACTION_HISTORY);
    const activityStats = bucketInteractions(interactionHistory, {
      bucket: "day",
    });

    let forYou: {
      ok: true;
      suggestions: ReturnType<typeof listActiveSuggestions>;
      tracked: number;
      needed: number;
      extra: ReturnType<typeof getExtraUsage> | null;
    } = {
      ok: true,
      suggestions: [],
      tracked: 0,
      needed: MIN_T24H_SNAPSHOTS,
      extra: null,
    };
    let coaching: {
      dayUtc: string;
      nextAction: null;
      missions: Awaited<ReturnType<typeof listMissionsWithProgress>>;
    } | null = null;

    if (user) {
      const billing = ensureUserBillingRow(user.id, tenantId);
      const planKey = resolvePlan(billing, user.email).planKey;
      forYou = {
        ok: true,
        suggestions: listActiveSuggestions(user.id),
        tracked: countT24hSnapshots(user.id),
        needed: MIN_T24H_SNAPSHOTS,
        extra: getExtraUsage({ userId: user.id, tenantId, planKey }),
      };
      const nowMs = Date.now();
      const snapshot = await buildCoachingSnapshot({
        userId: user.id,
        tenantId,
        nowMs,
      });
      coaching = {
        dayUtc: snapshot.dayUtc,
        nextAction: null,
        missions: await listMissionsWithProgress({
          userId: user.id,
          snapshot,
          nowMs,
        }),
      };
    }

    send(
      req,
      res,
      200,
      {
        ok: true,
        authRequired: required,
        user: user ? publicUser(user) : null,
        desk: {
          interacted: {
            interactions,
            activeIds: active.map((i) => i.threadId),
          },
          dismissed: {
            dismissals: dismissals.map(({ authorKey: _k, ...rest }) => rest),
            dismissedIds: dismissals.map((d) => d.threadId),
          },
          skipped: {
            skipped: skipped.map(({ authorKey: _k, ...rest }) => rest),
            skippedIds: skipped.map((d) => d.threadId),
          },
          expired: {
            expired,
            expiredIds: expired.map((e) => e.threadId),
          },
          forYou,
          lastScout,
          scoutLog: { entries: scoutLog },
          gamification,
          activityStats,
          coaching,
        },
      },
      NO_STORE,
    );
  } catch (err) {
    console.error("boot read failed:", err);
    send(
      req,
      res,
      500,
      {
        error: "store_failed",
        message: "Failed to load desk",
      },
      NO_STORE,
    );
  }
  return true;
}
