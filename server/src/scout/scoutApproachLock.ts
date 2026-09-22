import { objectValue } from "../platform/unknownValue.js";
import { isRecord } from "../platform/unknownValue.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getPlatformDb } from "../db.js";
import {
  BODY_CAP_16K,
  BodyError,
  readBody,
  send,
} from "../http/httpJson.js";
import { getSessionUser } from "../auth/sessionCookie.js";
import { allowRate } from "../auth/authGuard.js";
import { retainScoutContextForTarget } from "./scoutEvidenceContext.js";

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
  const row = parseGetScoutApproachLockRow(getPlatformDb()
    .prepare(
      `SELECT card_id, conversation_id, in_reply_to_id, surface, author, url, text, updated_at
       FROM scout_approach_locks WHERE user_id = ?`,
    )
    .get(userId));
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
    "reply",
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
  if (!allowRate(`scout-approach-lock:${user.id}`, 40, 60_000)) {
    send(req, res, 429, { error: "rate_limited" });
    return true;
  }

  let body: Record<string, unknown>;
  try {
    body = objectValue((await readBody(req, {
      maxBytes: BODY_CAP_16K,
      requireObject: true,
      rejectArray: true,
    })));
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
  const raw = objectValue(body.card);
  const id = optionalText(raw.id);
  if (!id) {
    send(req, res, 400, { error: "card_id_required" });
    return true;
  }
  const conversationId = optionalText(raw.conversationId);
  const inReplyToId = optionalText(raw.inReplyToId);
  const author = optionalText(raw.author);
  const text = optionalText(raw.text);
  setScoutApproachLock(user.id, {
    id,
    conversationId,
    inReplyToId,
    surface: raw.surface === "reply" ? "reply" : null,
    author,
    url: optionalText(raw.url),
    text,
  });
  try {
    await retainScoutContextForTarget({
      userId: user.id,
      targetId: id,
      conversationId,
      inReplyToId,
      fallbackAuthor: author,
      fallbackText: text,
      source: "lock",
    });
  } catch (err) {
    console.warn("scout approach-lock context retain soft-fail:", err);
  }
  send(req, res, 200, { ok: true });
  return true;
}

function parseGetScoutApproachLockRow(value: unknown): | {
        card_id: string;
        conversation_id: string | null;
        in_reply_to_id: string | null;
        surface: "reply" | "repost" | null;
        author: string | null;
        url: string | null;
        text: string | null;
        updated_at: string;
      }
    | undefined {
  const valid = (row: unknown): row is | {
        card_id: string;
        conversation_id: string | null;
        in_reply_to_id: string | null;
        surface: "reply" | "repost" | null;
        author: string | null;
        url: string | null;
        text: string | null;
        updated_at: string;
      }
    | undefined =>
    (row === undefined || (isRecord(row) &&
    typeof row.card_id === "string" &&
    (row.conversation_id === null || typeof row.conversation_id === "string") &&
    (row.in_reply_to_id === null || typeof row.in_reply_to_id === "string") &&
    (row.surface === null || row.surface === "reply" || row.surface === "repost") &&
    (row.author === null || typeof row.author === "string") &&
    (row.url === null || typeof row.url === "string") &&
    (row.text === null || typeof row.text === "string") &&
    typeof row.updated_at === "string"));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}
