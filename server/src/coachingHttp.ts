/**
 * GET /api/coaching — next action + today's missions.
 * One DeepSeek call only when the activity snapshot hash changes.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { ensureUserTenant } from "./billingStore.js";
import {
  buildCoachingSnapshot,
  hashCoachingSnapshot,
} from "./coachingSnapshot.js";
import { listMissionsWithProgress } from "./dailyMissions.js";
import { send } from "./httpJson.js";
import { getOrRefreshNextAction } from "./nextActionLlm.js";
import { getSessionUser } from "./sessionCookie.js";
import type { ChatFn } from "./voiceLlm.js";

export async function tryHandleCoaching(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  opts?: { chat?: ChatFn },
): Promise<boolean> {
  if (url.pathname !== "/api/coaching") return false;
  if (req.method !== "GET") return false;

  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, {
      error: "unauthenticated",
      message: "Sign in required",
    });
    return true;
  }

  const tenantId = ensureUserTenant(user.id);
  const nowMs = Date.now();
  try {
    const snapshot = await buildCoachingSnapshot({
      userId: user.id,
      tenantId,
      nowMs,
    });
    const inputsHash = hashCoachingSnapshot(snapshot);
    const [nextAction, missions] = await Promise.all([
      getOrRefreshNextAction({
        userId: user.id,
        snapshot,
        inputsHash,
        nowMs,
        chat: opts?.chat,
      }),
      listMissionsWithProgress({
        userId: user.id,
        snapshot,
        nowMs,
      }),
    ]);
    send(req, res, 200, {
      ok: true,
      dayUtc: snapshot.dayUtc,
      nextAction: {
        kind: nextAction.kind,
        text: nextAction.text,
        updatedAt: nextAction.updatedAt,
      },
      missions,
    });
  } catch (err) {
    console.error("coaching read failed:", err);
    send(req, res, 500, {
      error: "store_failed",
      message: "Failed to load coaching",
    });
  }
  return true;
}
