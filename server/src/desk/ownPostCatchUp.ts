import type { IncomingMessage, ServerResponse } from "node:http";
import { send } from "../http/httpJson.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { allowRate } from "../auth/authGuard.js";
import { getUserById } from "../auth/authStore.js";
import {
  creditsExhaustedResponse,
  dailyActivityUsage,
} from "../billing/billingQuotas.js";
import { ensureUserTenant } from "../billing/billingStore.js";
import { isRecord } from "../platform/unknownValue.js";
import { xApiGet } from "../x-api/xApi.js";
import {
  parsePostCreateEvent,
  postUrl,
  type ParsedPostCreate,
} from "../x-api/xActivity.js";
import {
  activitySubscriptionPaused,
  resolveStoredXUserId,
} from "../x-api/xActivitySubscribe.js";
import { publishDeskEvent } from "./deskEvents.js";
import { rememberActivityEvent, upsertOwnPost } from "./ownPostStore.js";
import { markOwnReplyInteracted, type OwnReplyMemoryOpts } from "./ownReplyMark.js";

export const OWN_POST_CATCH_UP_PATH = "/api/desk/own-posts/catch-up";
export const OWN_POST_CATCH_UP_MAX_RESULTS = 5;

type CatchUpHold = "credits" | "daily_cap" | "paused";

type CatchUpGate =
  | { open: true; tenantId: string; used: number; limit: number }
  | { open: false; hold: CatchUpHold };

export type OwnPostCatchUpResult =
  | { ok: true; stored: number; hold?: CatchUpHold }
  | { ok: false; status: number; error: string };

function catchUpGate(userId: string): CatchUpGate {
  if (activitySubscriptionPaused(userId)) return { open: false, hold: "paused" };
  const tenantId = ensureUserTenant(userId);
  const email = getUserById(userId)?.email ?? null;
  if (creditsExhaustedResponse({ userId, tenantId, email })) {
    return { open: false, hold: "credits" };
  }
  const activity = dailyActivityUsage(userId, email);
  if (!activity.can_watch) return { open: false, hold: "daily_cap" };
  return { open: true, tenantId, used: activity.used, limit: activity.limit };
}

export function catchUpPostsFromUserTweets(
  json: unknown,
  xUserId: string,
): ParsedPostCreate[] {
  if (!isRecord(json) || !Array.isArray(json.data)) return [];
  const includes = json.includes;
  return json.data
    .flatMap((payload: unknown) => {
      const parsed = parsePostCreateEvent({
        event_type: "post.create",
        payload,
        includes,
        filter: { user_id: xUserId },
      });
      return parsed && parsed.kind !== "repost" ? [parsed] : [];
    })
    .reverse();
}

export async function catchUpOwnPosts(
  userId: string,
  opts?: { memory?: OwnReplyMemoryOpts },
): Promise<OwnPostCatchUpResult> {
  const xUserId = resolveStoredXUserId(userId);
  if (!xUserId) return { ok: false, status: 409, error: "x_user_id_unresolved" };
  const before = catchUpGate(userId);
  if (!before.open) return { ok: true, stored: 0, hold: before.hold };
  const read = await xApiGet({
    path: `/users/${encodeURIComponent(xUserId)}/tweets`,
    query: {
      max_results: String(OWN_POST_CATCH_UP_MAX_RESULTS),
      exclude: "retweets",
      "tweet.fields":
        "created_at,author_id,conversation_id,in_reply_to_user_id,referenced_tweets,public_metrics",
      expansions: "author_id,in_reply_to_user_id",
      "user.fields": "username",
    },
  });
  if (!read.ok) return { ok: false, status: 502, error: read.error };
  const gate = catchUpGate(userId);
  if (!gate.open) return { ok: true, stored: 0, hold: gate.hold };
  let used = gate.used;
  let stored = 0;
  for (const parsed of catchUpPostsFromUserTweets(read.json, xUserId)) {
    if (used >= gate.limit) return { ok: true, stored, hold: "daily_cap" };
    if (!upsertOwnPost({ parsed, userId, tenantId: gate.tenantId })) continue;
    rememberActivityEvent(`post.create:${parsed.postId}`, parsed.postedAt);
    used += 1;
    stored += 1;
    publishDeskEvent(userId, "own_post", {
      id: parsed.postId,
      kind: parsed.kind,
      postedAt: parsed.postedAt,
      url: postUrl(parsed.authorUsername, parsed.postId),
      text: parsed.text,
    });
    try {
      await markOwnReplyInteracted(parsed, userId, {
        ...opts?.memory,
        publishInteracted: (interaction) => {
          publishDeskEvent(userId, "interacted", interaction);
        },
      });
    } catch (err) {
      console.warn("[desk] catch-up mark soft-fail", err);
    }
  }
  return { ok: true, stored };
}

export async function tryHandleOwnPostCatchUp(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== OWN_POST_CATCH_UP_PATH) return false;
  if (req.method !== "POST") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }
  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, { error: "unauthenticated", message: "Sign in required" });
    return true;
  }
  if (!allowRate(`own-post-catch-up:${user.id}`, 40, 60_000)) {
    send(req, res, 429, { error: "rate_limited" });
    return true;
  }
  const result = await catchUpOwnPosts(user.id);
  if (!result.ok) {
    send(req, res, result.status, { error: result.error });
    return true;
  }
  send(req, res, 200, result);
  return true;
}

export async function tryHandleOwnPostCatchUpBeforeAuth(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "POST") return false;
  return tryHandleOwnPostCatchUp(req, res, url);
}
