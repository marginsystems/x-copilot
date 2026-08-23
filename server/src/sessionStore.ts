/**
 * Hashed session persistence and client metadata.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getUserById, type AuthUser } from "./authStore.js";
import { getPlatformDb } from "./db.js";

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_META_UA_MAX = 512;
const SESSION_META_IP_MAX = 128;
const LAST_SEEN_THROTTLE_MS = 60_000;

export type SessionClientMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

export type SessionListRow = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  createdIp: string | null;
  lastSeenIp: string | null;
  createdUserAgent: string | null;
  lastSeenUserAgent: string | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function clipMetaIp(ip: string | null | undefined): string | null {
  const trimmed = ip?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, SESSION_META_IP_MAX);
}

function clipMetaUa(ua: string | null | undefined): string | null {
  const trimmed = ua?.trim() ?? "";
  if (!trimmed) return null;
  return trimmed.slice(0, SESSION_META_UA_MAX);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function createSession(
  userId: string,
  meta?: SessionClientMeta,
): { token: string; expiresAt: string; id: string } {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const id = randomUUID();
  const createdAt = nowIso();
  const ip = clipMetaIp(meta?.ip);
  const userAgent = clipMetaUa(meta?.userAgent);
  const database = getPlatformDb();
  const insert = database.transaction(() => {
    database
      .prepare(`DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL`)
      .run(nowIso());
    database
      .prepare(
        `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, userId, hashSessionToken(token), expiresAt, createdAt);
    database
      .prepare(
        `INSERT INTO session_meta (
           session_id, user_id, created_ip, created_user_agent,
           last_seen_at, last_seen_ip, last_seen_user_agent
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, userId, ip, userAgent, createdAt, ip, userAgent);
  });
  insert();
  return { token, expiresAt, id };
}

export function getSessionForToken(
  token: string,
): { user: AuthUser; sessionId: string } | null {
  const hash = hashSessionToken(token);
  const row = getPlatformDb()
    .prepare(
      `SELECT s.id, s.user_id, s.expires_at, s.revoked_at
       FROM sessions s WHERE s.token_hash = ?`,
    )
    .get(hash) as
    | { id: string; user_id: string; expires_at: string; revoked_at: string | null }
    | undefined;
  if (!row || row.revoked_at) return null;
  if (Date.parse(row.expires_at) <= Date.now()) return null;
  const user = getUserById(row.user_id);
  if (!user) return null;
  return { user, sessionId: row.id };
}

export function getUserForSessionToken(token: string): AuthUser | null {
  return getSessionForToken(token)?.user ?? null;
}

export function touchSessionMeta(
  sessionId: string,
  userId: string,
  meta?: SessionClientMeta,
): void {
  const now = nowIso();
  const ip = clipMetaIp(meta?.ip);
  const userAgent = clipMetaUa(meta?.userAgent);
  const database = getPlatformDb();
  const existing = database
    .prepare(
      `SELECT last_seen_at FROM session_meta WHERE session_id = ? AND user_id = ?`,
    )
    .get(sessionId, userId) as { last_seen_at: string } | undefined;
  if (existing) {
    const last = Date.parse(existing.last_seen_at);
    if (Number.isFinite(last) && Date.now() - last < LAST_SEEN_THROTTLE_MS) {
      return;
    }
    database
      .prepare(
        `UPDATE session_meta
         SET last_seen_at = ?, last_seen_ip = ?, last_seen_user_agent = ?
         WHERE session_id = ? AND user_id = ?`,
      )
      .run(now, ip, userAgent, sessionId, userId);
    return;
  }
  database
    .prepare(
      `INSERT INTO session_meta (
         session_id, user_id, created_ip, created_user_agent,
         last_seen_at, last_seen_ip, last_seen_user_agent
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(sessionId, userId, null, null, now, ip, userAgent);
}

export function listSessionsForUser(userId: string): SessionListRow[] {
  const rows = getPlatformDb()
    .prepare(
      `SELECT s.id AS id,
              s.created_at AS created_at,
              COALESCE(m.last_seen_at, s.created_at) AS last_seen_at,
              m.created_ip AS created_ip,
              m.last_seen_ip AS last_seen_ip,
              m.created_user_agent AS created_user_agent,
              m.last_seen_user_agent AS last_seen_user_agent
       FROM sessions s
       LEFT JOIN session_meta m
         ON m.session_id = s.id AND m.user_id = s.user_id
       WHERE s.user_id = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?
       ORDER BY s.created_at DESC`,
    )
    .all(userId, nowIso()) as Array<{
    id: string;
    created_at: string;
    last_seen_at: string;
    created_ip: string | null;
    last_seen_ip: string | null;
    created_user_agent: string | null;
    last_seen_user_agent: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    createdIp: row.created_ip,
    lastSeenIp: row.last_seen_ip,
    createdUserAgent: row.created_user_agent,
    lastSeenUserAgent: row.last_seen_user_agent,
  }));
}

export function revokeSessionById(userId: string, sessionId: string): boolean {
  const result = getPlatformDb()
    .prepare(
      `UPDATE sessions
       SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), sessionId, userId);
  return result.changes > 0;
}

export function revokeOtherSessions(userId: string, keepSessionId: string): number {
  const result = getPlatformDb()
    .prepare(
      `UPDATE sessions
       SET revoked_at = ?
       WHERE user_id = ? AND id != ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), userId, keepSessionId);
  return result.changes;
}

export function revokeSessionToken(token: string): void {
  getPlatformDb()
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), hashSessionToken(token));
}
