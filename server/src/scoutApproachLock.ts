import type { IncomingMessage, ServerResponse } from "node:http";
import { getPlatformDb } from "./db.js";
import {
  BODY_CAP_16K,
  BodyError,
  readBody,
  send,
} from "./httpJson.js";
import { getSessionUser } from "./sessionCookie.js";

const SCOUT_APPROACH_LOCK_TTL_MS = 24 * 60 * 60 * 1000;

export type ScoutApproachLock = {
  id: string;
  conversationId: string | null;
  inReplyToId: string | null;
  surface: "reply" | "repost" | null;
  author: string | null;
  url: string | null;
  text: string | null;
};

function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

export function getScoutApproachLock(
  userId: string,
  nowMs: number = Date.now(),
): ScoutApproachLock | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT card_id, conversation_id, in_reply_to_id, surface, author, url, text, updated_at
       FROM scout_approach_locks WHERE user_id = ?`,
    )
    .get(userId) as
    | {
        card_id: string;
        conversation_id: string | null;
        in_reply_to_id: string | null;
        surface: "reply" | "repost" | null;
        author: string | null;
        url: string | null;
        text: string | null;
        updated_at: string;
      }
    | undefined;
  if (!row) return null;
  const updatedAt = Date.parse(row.updated_at);
  if (
    !Number.isFinite(updatedAt) ||
    nowMs - updatedAt > SCOUT_APPROACH_LOCK_TTL_MS
  ) {
    getPlatformDb()
      .prepare(`DELETE FROM scout_approach_locks WHERE user_id = ?`)
      .run(userId);
    return null;
  }
  return {
    id: row.card_id,
    conversationId: row.conversation_id,
    inReplyToId: row.in_reply_to_id,
    surface: row.surface,
    author: row.author,
    url: row.url,
    text: row.text,
  };
}

export function setScoutApproachLock(
  userId: string,
  card: ScoutApproachLock | null,
): void {
  const db = getPlatformDb();
  if (!card) {
    db.prepare(`DELETE FROM scout_approach_locks WHERE user_id = ?`).run(userId);
    return;
  }
  const id = card.id.trim();
  if (!id) return;
  db.prepare(
    `INSERT INTO scout_approach_locks
       (user_id, card_id, conversation_id, in_reply_to_id, surface, author, url, text, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       card_id = excluded.card_id,
       conversation_id = excluded.conversation_id,
       in_reply_to_id = excluded.in_reply_to_id,
       surface = excluded.surface,
       author = excluded.author,
       url = excluded.url,
       text = excluded.text,
       updated_at = excluded.updated_at`,
  ).run(
    userId,
    id,
    card.conversationId,
    card.inReplyToId,
    card.surface ?? "reply",
    card.author,
    card.url,
    card.text,
    new Date().toISOString(),
  );
}

export async function tryHandleScoutApproachLock(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<boolean> {
  if (url.pathname !== "/api/scout-approach-lock") return false;
  if (req.method !== "PUT") {
    send(req, res, 405, { error: "method_not_allowed" });
    return true;
  }
  const user = getSessionUser(req);
  if (!user) {
    send(req, res, 401, { error: "unauthenticated" });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = (await readBody(req, {
      maxBytes: BODY_CAP_16K,
      requireObject: true,
      rejectArray: true,
    })) as Record<string, unknown>;
  } catch (err) {
    send(req, res, err instanceof BodyError ? err.statusCode : 400, {
      error: "bad_request",
    });
    return true;
  }

  if (body.card === null) {
    setScoutApproachLock(user.id, null);
    send(req, res, 200, { ok: true });
    return true;
  }
  if (!body.card || typeof body.card !== "object") {
    send(req, res, 400, { error: "card_required" });
    return true;
  }
  const raw = body.card as Record<string, unknown>;
  const id = optionalText(raw.id);
  if (!id) {
    send(req, res, 400, { error: "card_id_required" });
    return true;
  }
  setScoutApproachLock(user.id, {
    id,
    conversationId: optionalText(raw.conversationId),
    inReplyToId: optionalText(raw.inReplyToId),
    surface:
      raw.surface === "reply" || raw.surface === "repost" ? raw.surface : null,
    author: optionalText(raw.author),
    url: optionalText(raw.url),
    text: optionalText(raw.text),
  });
  send(req, res, 200, { ok: true });
  return true;
}
