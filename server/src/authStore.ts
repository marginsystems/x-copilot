/**
 * Users, OAuth identities, and hashed sessions in the platform SQLite DB.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getPlatformDb } from "./db.js";

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
};

export type OauthAccount = {
  id: string;
  userId: string;
  provider: "google" | "x";
  providerUserId: string;
  email: string | null;
  username: string | null;
  createdAt: string;
};

export type AuthSession = {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
  revokedAt: string | null;
};

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function nowIso(): string {
  return new Date().toISOString();
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function mapUser(row: {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
}): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export function getUserById(id: string): AuthUser | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT id, email, display_name, avatar_url, created_at, last_login_at
       FROM users WHERE id = ?`,
    )
    .get(id) as
    | {
        id: string;
        email: string | null;
        display_name: string | null;
        avatar_url: string | null;
        created_at: string;
        last_login_at: string | null;
      }
    | undefined;
  return row ? mapUser(row) : null;
}

export function getUserByEmail(email: string): AuthUser | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const row = getPlatformDb()
    .prepare(
      `SELECT id, email, display_name, avatar_url, created_at, last_login_at
       FROM users WHERE email = ?`,
    )
    .get(normalized) as
    | {
        id: string;
        email: string | null;
        display_name: string | null;
        avatar_url: string | null;
        created_at: string;
        last_login_at: string | null;
      }
    | undefined;
  return row ? mapUser(row) : null;
}

export function findOauthAccount(
  provider: "google" | "x",
  providerUserId: string,
): OauthAccount | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT id, user_id, provider, provider_user_id, email, username, created_at
       FROM oauth_accounts WHERE provider = ? AND provider_user_id = ?`,
    )
    .get(provider, providerUserId) as
    | {
        id: string;
        user_id: string;
        provider: "google" | "x";
        provider_user_id: string;
        email: string | null;
        username: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    email: row.email,
    username: row.username,
    createdAt: row.created_at,
  };
}

export function upsertOauthUser(opts: {
  provider: "google" | "x";
  providerUserId: string;
  email?: string | null;
  emailVerified: boolean;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}): AuthUser {
  const database = getPlatformDb();
  const email = opts.email?.trim().toLowerCase() || null;
  const at = nowIso();
  const upsert = database.transaction((): AuthUser => {
    const existing = findOauthAccount(opts.provider, opts.providerUserId);
    if (existing) {
      database
        .prepare(
          `UPDATE users SET
             email = COALESCE(?, email),
             display_name = COALESCE(?, display_name),
             avatar_url = COALESCE(?, avatar_url),
             last_login_at = ?
           WHERE id = ?`,
        )
        .run(
          email,
          opts.displayName ?? null,
          opts.avatarUrl ?? null,
          at,
          existing.userId,
        );
      database
        .prepare(
          `UPDATE oauth_accounts SET email = ?, username = ? WHERE id = ?`,
        )
        .run(email, opts.username ?? null, existing.id);
      const user = getUserById(existing.userId);
      if (!user) throw new Error("oauth user missing after update");
      return user;
    }

    const byEmail = email && opts.emailVerified ? getUserByEmail(email) : null;
    const userId = byEmail?.id ?? randomUUID();
    if (!byEmail) {
      database
        .prepare(
          `INSERT INTO users (id, email, display_name, avatar_url, created_at, last_login_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          opts.emailVerified ? email : null,
          opts.displayName ?? null,
          opts.avatarUrl ?? null,
          at,
          at,
        );
    } else {
      database
        .prepare(
          `UPDATE users SET
             display_name = COALESCE(?, display_name),
             avatar_url = COALESCE(?, avatar_url),
             last_login_at = ?
           WHERE id = ?`,
        )
        .run(opts.displayName ?? null, opts.avatarUrl ?? null, at, userId);
    }

    database
      .prepare(
        `INSERT INTO oauth_accounts
           (id, user_id, provider, provider_user_id, email, username, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        userId,
        opts.provider,
        opts.providerUserId,
        opts.emailVerified ? email : null,
        opts.username ?? null,
        at,
      );

    const user = getUserById(userId);
    if (!user) throw new Error("oauth user missing after insert");
    return user;
  });
  return upsert();
}

export function createSession(userId: string): { token: string; expiresAt: string } {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const database = getPlatformDb();
  database
    .prepare(`DELETE FROM sessions WHERE expires_at < ? OR revoked_at IS NOT NULL`)
    .run(nowIso());
  database
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(randomUUID(), userId, hashSessionToken(token), expiresAt, nowIso());
  return { token, expiresAt };
}

export function getUserForSessionToken(token: string): AuthUser | null {
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
  return getUserById(row.user_id);
}

export function revokeSessionToken(token: string): void {
  getPlatformDb()
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
    )
    .run(nowIso(), hashSessionToken(token));
}
