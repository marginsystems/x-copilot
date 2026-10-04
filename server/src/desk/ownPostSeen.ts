import type { IncomingMessage, ServerResponse } from "node:http";
import { allowRate } from "../auth/authGuard.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { getPlatformDb } from "../db.js";
import { readJsonBody, send } from "../http/httpJson.js";
import { isRecord } from "../platform/unknownValue.js";
import { postUrl } from "../x-api/xActivity.js";
import { publishDeskEvent } from "./deskEvents.js";

export const OWN_POST_SEEN_PATH = "/api/desk/own-posts/seen";
export const OWN_POST_CONFIRM_WINDOW_MS = 10 * 60_000;
export const OWN_POST_CONFIRM_SWEEP_MS = 60_000;

const TWITTER_SNOWFLAKE_EPOCH_MS = 1288834974657;
const SNOWFLAKE_CLOCK_TRUST_MS = 60 * 60_000;
const POST_ID_PATTERN = /^\d{1,19}$/;
const POST_URL_PATTERN = /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)$/;

export type SeenOwnPost = { postId: string; url: string; pageStatusId: string | null };

export type SeenOwnPostState = "provisional" | "confirmed" | "unconfirmed";

export type UnconfirmedOwnPost = { userId: string; id: string; url: string; seenAt: string };

let confirmSweep: ReturnType<typeof setInterval> | null = null;

export function parseSeenOwnPost(raw: unknown): SeenOwnPost | null {
  if (!isRecord(raw)) return null;
  const { postId, url, pageStatusId } = raw;
  if (typeof postId !== "string" || !POST_ID_PATTERN.test(postId)) return null;
  if (pageStatusId != null && (typeof pageStatusId !== "string" || !POST_ID_PATTERN.test(pageStatusId))) {
    return null;
  }
  const link = typeof url === "string" ? POST_URL_PATTERN.exec(url) : null;
  const handle = link && link[2] === postId ? link[1] ?? null : null;
  return { postId, url: postUrl(handle, postId), pageStatusId: pageStatusId ?? null };
}

export function provisionalPostedAt(postId: string, nowMs: number): string {
  const snowflakeMs = Number(BigInt(postId) >> 22n) + TWITTER_SNOWFLAKE_EPOCH_MS;
  const trusted = Math.abs(nowMs - snowflakeMs) <= SNOWFLAKE_CLOCK_TRUST_MS;
  return new Date(trusted ? snowflakeMs : nowMs).toISOString();
}

function ownPostIngested(userId: string, postId: string): boolean {
  return getPlatformDb()
    .prepare(`SELECT 1 AS found FROM own_posts WHERE id = ? AND user_id = ?`)
    .get(postId, userId) !== undefined;
}

export function seenOwnPostState(userId: string, postId: string): SeenOwnPostState | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT confirmed_at AS confirmedAt, unconfirmed_at AS unconfirmedAt
         FROM extension_seen_posts
        WHERE user_id = ? AND post_id = ?`,
    )
    .get(userId, postId);
  if (!isRecord(row)) return null;
  if (row.confirmedAt || ownPostIngested(userId, postId)) return "confirmed";
  return row.unconfirmedAt ? "unconfirmed" : "provisional";
}

export function recordSeenOwnPost(
  userId: string,
  seen: SeenOwnPost,
  nowMs = Date.now(),
): SeenOwnPostState {
  const nowIso = new Date(nowMs).toISOString();
  const ingested = ownPostIngested(userId, seen.postId);
  const inserted = getPlatformDb()
    .prepare(
      `INSERT OR IGNORE INTO extension_seen_posts
         (user_id, post_id, url, page_status_id, seen_at, confirmed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, seen.postId, seen.url, seen.pageStatusId, nowIso, ingested ? nowIso : null);
  if (ingested) return "confirmed";
  startOwnPostConfirmSweep();
  if (Number(inserted.changes) === 0) return seenOwnPostState(userId, seen.postId) ?? "provisional";
  publishDeskEvent(userId, "own_post", {
    id: seen.postId,
    kind: seen.pageStatusId ? "reply" : "original",
    postedAt: provisionalPostedAt(seen.postId, nowMs),
    url: seen.url,
    text: "",
    provisional: true,
  }, nowMs);
  return "provisional";
}

function parseOverdueRows(value: unknown): UnconfirmedOwnPost[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row: unknown) =>
    isRecord(row) &&
    typeof row.userId === "string" &&
    typeof row.id === "string" &&
    typeof row.url === "string" &&
    typeof row.seenAt === "string"
      ? [{ userId: row.userId, id: row.id, url: row.url, seenAt: row.seenAt }]
      : [],
  );
}

export function settleSeenOwnPosts(nowMs = Date.now()): UnconfirmedOwnPost[] {
  const db = getPlatformDb();
  const nowIso = new Date(nowMs).toISOString();
  const confirmed = db
    .prepare(
      `SELECT extension_seen_posts.user_id AS userId, own_posts.id, own_posts.kind,
              own_posts.posted_at AS postedAt, own_posts.url, own_posts.text
         FROM extension_seen_posts
         JOIN own_posts
           ON own_posts.id = extension_seen_posts.post_id
          AND own_posts.user_id = extension_seen_posts.user_id
         WHERE extension_seen_posts.confirmed_at IS NULL
           AND extension_seen_posts.unconfirmed_at IS NOT NULL`,
    )
    .all();
  db.prepare(
    `UPDATE extension_seen_posts
        SET confirmed_at = ?
      WHERE confirmed_at IS NULL
        AND EXISTS (
          SELECT 1 FROM own_posts
           WHERE own_posts.id = extension_seen_posts.post_id
             AND own_posts.user_id = extension_seen_posts.user_id
        )`,
  ).run(nowIso);
  for (const post of confirmed) {
    if (
      !isRecord(post) ||
      typeof post.userId !== "string" ||
      typeof post.id !== "string" ||
      typeof post.kind !== "string" ||
      typeof post.postedAt !== "string"
    ) continue;
    publishDeskEvent(post.userId, "own_post", {
      id: post.id,
      kind: post.kind,
      postedAt: post.postedAt,
      url: typeof post.url === "string" ? post.url : postUrl(null, post.id),
      text: typeof post.text === "string" ? post.text : "",
    }, nowMs);
  }
  const overdue = parseOverdueRows(db
    .prepare(
      `SELECT user_id AS userId, post_id AS id, url, seen_at AS seenAt
         FROM extension_seen_posts
        WHERE confirmed_at IS NULL AND unconfirmed_at IS NULL AND seen_at <= ?
        ORDER BY seen_at`,
    )
    .all(new Date(nowMs - OWN_POST_CONFIRM_WINDOW_MS).toISOString()));
  const flag = db.prepare(
    `UPDATE extension_seen_posts SET unconfirmed_at = ? WHERE user_id = ? AND post_id = ?`,
  );
  for (const post of overdue) {
    flag.run(nowIso, post.userId, post.id);
    publishDeskEvent(post.userId, "own_post_unconfirmed", {
      id: post.id,
      url: post.url,
      seenAt: post.seenAt,
    }, nowMs);
  }
  return overdue;
}

export function startOwnPostConfirmSweep(): void {
  if (confirmSweep) return;
  confirmSweep = setInterval(() => {
    try {
      settleSeenOwnPosts();
    } catch (err) {
      console.warn("[desk] own post confirm sweep", err);
    }
  }, OWN_POST_CONFIRM_SWEEP_MS);
  confirmSweep.unref();
}

export function stopOwnPostConfirmSweepForTests(): void {
  if (confirmSweep) clearInterval(confirmSweep);
  confirmSweep = null;
}

export async function tryHandleOwnPostSeen(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== OWN_POST_SEEN_PATH) return false;
  if (req.method !== "POST") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }
  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, { error: "unauthenticated", message: "Sign in required" });
    return true;
  }
  if (!allowRate(`own-post-seen:${user.id}`, 40, 60_000)) {
    send(req, res, 429, { error: "rate_limited" });
    return true;
  }
  const seen = parseSeenOwnPost(await readJsonBody(req));
  if (!seen) {
    send(req, res, 400, { error: "bad_request" });
    return true;
  }
  send(req, res, 200, { ok: true, state: recordSeenOwnPost(user.id, seen) });
  return true;
}
