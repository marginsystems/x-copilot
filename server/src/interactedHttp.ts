/**
 * Interacted list, stats, mark-detect, and mark.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  LIVE_METRICS_ID_CAP,
  bucketInteractions,
  mergeLiveMetrics,
  parseActivityBucket,
  pendingReplyIds,
} from "./activityStats.js";
import { trackAnalytics } from "./analyticsClient.js";
import { getXOauthUsername } from "./authStore.js";
import {
  detectOwnReplyToThread,
  detectOwnReplyToThreadWithRetry,
  resolveDetectScreenName,
} from "./detectReply.js";
import { recordMarkGamification } from "./gamification.js";
import { sendCreditsExhausted } from "./httpGates.js";
import { BodyError, readBody, send } from "./httpJson.js";
import {
  listActiveInteractions,
  listInteractionHistory,
  markInteracted,
  MAX_INTERACTION_STORE,
} from "./interactionStore.js";
import { setGamificationSyncFailed } from "./interactionSync.js";
import {
  normalizeAuthorKey,
  parseStatusIdFromUrl,
} from "./interactionCooldown.js";
import {
  normalizeReply,
  writeInteractionMemory,
} from "./knowledgeMemory.js";
import { scheduleMemoryUpsert } from "./memoryReindex.js";
import { getSessionUser } from "./sessionCookie.js";
import { fetchTweetMetricsMany } from "./tweetLookup.js";

export async function tryHandleInteracted(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (req.method === "GET" && url.pathname === "/api/interacted/stats") {
    const bucket = parseActivityBucket(url.searchParams.get("bucket"));
    // Read the durable retain (not the 200-row feed cap) so 28d/12w bucketing
    // sees in-window marks before any secondary trim.
    const history = await listInteractionHistory({
      limit: MAX_INTERACTION_STORE,
    });
    const pending = pendingReplyIds(history, LIVE_METRICS_ID_CAP);
    let rows = history;
    if (pending.length) {
      const live = await fetchTweetMetricsMany({ tweetIds: pending });
      rows = mergeLiveMetrics(history, live);
    }
    send(req, res, 200, bucketInteractions(rows, { bucket }));
    return true;
  }

  if (req.method === "GET" && url.pathname === "/api/interacted") {
    const [interactions, active] = await Promise.all([
      listInteractionHistory(),
      listActiveInteractions(),
    ]);
    send(req, res, 200, {
      interactions,
      activeIds: active.map((i) => i.threadId),
    });
    return true;
  }

  if (req.method === "POST" && url.pathname === "/api/interacted/detect") {
    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const threadId =
      typeof body.threadId === "string" ? body.threadId.trim() : "";
    if (!threadId) {
      send(req, res, 400, {
        error: "bad_request",
        message: "Pass { threadId: string }.",
      });
      return true;
    }
    const conversationId =
      typeof body.conversationId === "string"
        ? body.conversationId.trim()
        : undefined;
    const appUser = getSessionUser(req);
    const screenName = resolveDetectScreenName(
      appUser ? getXOauthUsername(appUser.id) : null,
    );
    if (!screenName) {
      send(req, res, 503, {
        error: "identity_unresolved",
        message:
          "Set your X username in setup so Mark detect can find your replies.",
      });
      return true;
    }
    if (sendCreditsExhausted(req, res)) return true;
    /** Client-owned polling sends once:true; omit/false keeps server backoff. */
    const once = body.once === true;
    const ac = new AbortController();
    const onClose = () => ac.abort();
    req.once("close", onClose);
    try {
      const detected = once
        ? await detectOwnReplyToThread({
            threadId,
            conversationId,
            screenName,
            signal: ac.signal,
          })
        : await detectOwnReplyToThreadWithRetry({
            threadId,
            conversationId,
            screenName,
            signal: ac.signal,
          });
      if (detected.reply) {
        send(req, res, 200, {
          ok: true,
          found: true,
          reply: detected.reply,
        });
        return true;
      }
      send(req, res, 200, {
        ok: true,
        found: false,
        reason: detected.reason,
      });
      return true;
    } finally {
      req.off("close", onClose);
    }
  }

  if (req.method === "POST" && url.pathname === "/api/interacted") {
    let body: Record<string, unknown>;
    try {
      body = (await readBody(req)) as Record<string, unknown>;
    } catch (err) {
      const statusCode = err instanceof BodyError ? err.statusCode : 400;
      send(req, res, statusCode, {
        error: "bad_request",
        message: err instanceof Error ? err.message : "Invalid request body",
      });
      return true;
    }
    const threadId = typeof body.threadId === "string" ? body.threadId.trim() : "";
    const author = typeof body.author === "string" ? body.author.trim() : "";
    const replyUrl =
      typeof body.replyUrl === "string" ? body.replyUrl.trim() : "";
    const reply = normalizeReply(body.reply);
    const replyId = parseStatusIdFromUrl(replyUrl);
    if (!threadId || !author || !normalizeAuthorKey(author) || !replyId) {
      send(req, res, 400, {
        error: "bad_request",
        message:
          "Pass { threadId: string, author: string, replyUrl: string } with a valid x.com/twitter.com status URL.",
      });
      return true;
    }
    const sessionUser = getSessionUser(req);
    const source = "manual";
    const flags = Array.isArray(body.flags)
      ? body.flags.filter((f): f is string => typeof f === "string")
      : undefined;
    const baitScore =
      typeof body.baitScore === "number"
        ? body.baitScore
        : typeof body.score === "number"
          ? body.score
          : undefined;
    try {
      const url = typeof body.url === "string" ? body.url : undefined;
      const text = typeof body.text === "string" ? body.text : undefined;
      const summary =
        typeof body.summary === "string" ? body.summary : undefined;
      const opAuthor =
        typeof body.opAuthor === "string" ? body.opAuthor : undefined;
      const opText =
        typeof body.opText === "string" ? body.opText : undefined;
      const conversationId =
        typeof body.conversationId === "string"
          ? body.conversationId
          : undefined;
      const inReplyToId =
        typeof body.inReplyToId === "string" ? body.inReplyToId : undefined;
      const interaction = await markInteracted({
        threadId,
        author,
        source,
        userId: sessionUser?.id,
        url,
        text,
        summary,
        replyId,
        replyUrl,
        conversationId,
        inReplyToId,
      });
      trackAnalytics({
        name: "mark.interacted",
        userId: sessionUser?.id,
        email: sessionUser?.email,
        handle: sessionUser?.xUsername,
        detail: author,
      });
      let gamification;
      try {
        gamification = await recordMarkGamification({
          threadId,
          userId: sessionUser?.id,
          nowMs: Date.parse(interaction.at) || Date.now(),
        });
      } catch (err) {
        // A successful re-mark of the same thread does not retroactively
        // credit an older soft-failed mark; keep the pending projection so
        // the stats-worker retry replays this exact mark's `at`.
        console.warn("gamification mark soft-fail:", err);
        await setGamificationSyncFailed({
          threadId,
          checkpoint: "mark",
          failed: true,
          pendingAt: interaction.at,
        }).catch(() => {});
      }
      let memoryPath: string | undefined;
      if (reply) {
        const memory = await writeInteractionMemory({
          threadId,
          author,
          reply,
          source,
          userId: sessionUser?.id,
          url,
          text,
          summary,
          opAuthor,
          opText,
          agenda: typeof body.agenda === "string" ? body.agenda : undefined,
          baitScore,
          engage: typeof body.engage === "string" ? body.engage : undefined,
          flags,
          intent: typeof body.intent === "string" ? body.intent : undefined,
          reason: typeof body.reason === "string" ? body.reason : undefined,
          // Match durable store timestamp so later stats ticks can rediscover the note.
          interactedAt: interaction.at,
        });
        memoryPath = memory.path;
        scheduleMemoryUpsert(memory.path, "interaction");
      }
      send(req, res, 200, {
        ok: true,
        interaction,
        memoryPath,
        ...(gamification ? { gamification } : {}),
      });
      return true;
    } catch (err) {
      console.error("Failed to store interaction:", err);
      send(req, res, 500, {
        error: "store_failed",
        message: "Failed to store interaction",
      });
      return true;
    }
  }

  return false;
}
