/**
 * X Activity API webhook helpers — CRC, signature, post.create parse.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type OwnPostKind = "original" | "reply" | "quote" | "repost";

export type ActivityMetrics = {
  views?: number;
  likes?: number;
  replies?: number;
  retweets?: number;
  bookmarks?: number;
};

export type ParsedPostCreate = {
  eventUuid: string;
  xUserId: string;
  postId: string;
  kind: OwnPostKind;
  text: string;
  postedAt: string;
  postedAtFallback?: boolean;
  inReplyToId: string | null;
  inReplyToUserId: string | null;
  conversationId: string | null;
  authorUsername: string | null;
  metrics: ActivityMetrics;
};

export function crcResponseToken(
  crcToken: string,
  consumerSecret: string,
): string {
  const hmac = createHmac("sha256", consumerSecret)
    .update(crcToken, "utf8")
    .digest("base64");
  return `sha256=${hmac}`;
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  consumerSecret: string,
): boolean {
  const got = (header ?? "").trim();
  if (!got.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", consumerSecret)
    .update(rawBody)
    .digest("base64")}`;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function metricsFromPublic(raw: unknown): ActivityMetrics {
  if (!raw || typeof raw !== "object") return {};
  const m = raw as Record<string, unknown>;
  return {
    views: asFiniteNumber(m.impression_count),
    likes: asFiniteNumber(m.like_count),
    replies: asFiniteNumber(m.reply_count),
    retweets: asFiniteNumber(m.retweet_count),
    bookmarks: asFiniteNumber(m.bookmark_count),
  };
}

function referencedTypes(payload: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const refs = payload.referenced_tweets;
  if (!Array.isArray(refs)) return out;
  for (const ref of refs) {
    if (!ref || typeof ref !== "object") continue;
    const t = String((ref as { type?: unknown }).type ?? "").trim();
    if (t) out.add(t);
  }
  return out;
}

export function classifyPostKind(payload: Record<string, unknown>): OwnPostKind {
  const refs = referencedTypes(payload);
  if (refs.has("retweeted")) return "repost";
  if (refs.has("quoted")) return "quote";
  if (payload.in_reply_to_tweet_id || refs.has("replied_to")) return "reply";
  return "original";
}

function usernameFromIncludes(
  json: Record<string, unknown>,
  authorId: string,
): string | null {
  const includes = json.includes;
  if (!includes || typeof includes !== "object") return null;
  const users = (includes as { users?: unknown }).users;
  if (!Array.isArray(users)) return null;
  for (const u of users) {
    if (!u || typeof u !== "object") continue;
    const row = u as { id?: unknown; username?: unknown };
    if (String(row.id ?? "") === authorId && typeof row.username === "string") {
      return row.username.replace(/^@+/, "");
    }
  }
  return null;
}

/** Pull a post.create event from an XAA webhook envelope (or a bare data object). */
export function parsePostCreateEvent(json: unknown): ParsedPostCreate | null {
  if (!json || typeof json !== "object") return null;
  const root = json as Record<string, unknown>;
  const data =
    root.data && typeof root.data === "object"
      ? (root.data as Record<string, unknown>)
      : root;
  const eventType = String(data.event_type ?? root.event_type ?? "");
  if (eventType && eventType !== "post.create") return null;

  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : data;
  const post = payload as Record<string, unknown>;
  const postId = String(post.id ?? "").trim();
  if (!postId) return null;

  const filter =
    data.filter && typeof data.filter === "object"
      ? (data.filter as { user_id?: unknown })
      : {};
  const xUserId = String(
    filter.user_id ?? post.author_id ?? "",
  ).trim();
  if (!xUserId) return null;

  const eventUuid = String(data.event_uuid ?? root.event_uuid ?? postId).trim();
  const createdMs =
    typeof post.created_at === "string" && post.created_at.trim()
      ? Date.parse(post.created_at)
      : NaN;
  const postedAt = Number.isFinite(createdMs)
    ? new Date(createdMs).toISOString()
    : new Date().toISOString();

  return {
    eventUuid,
    xUserId,
    postId,
    kind: classifyPostKind(post),
    text: typeof post.text === "string" ? post.text : "",
    postedAt,
    postedAtFallback: !Number.isFinite(createdMs),
    inReplyToId: post.in_reply_to_tweet_id
      ? String(post.in_reply_to_tweet_id)
      : null,
    inReplyToUserId: post.in_reply_to_user_id
      ? String(post.in_reply_to_user_id)
      : null,
    conversationId: post.conversation_id ? String(post.conversation_id) : null,
    authorUsername: usernameFromIncludes(data, xUserId),
    metrics: metricsFromPublic(post.public_metrics),
  };
}

export function postUrl(username: string | null, postId: string): string {
  const handle = (username ?? "i").replace(/^@+/, "") || "i";
  return `https://x.com/${handle}/status/${postId}`;
}
