/**
 * Users, OAuth identities, and hashed sessions in the platform SQLite DB.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  getUserBilling,
  hasLiveStripeSubscription,
} from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { parseXHandle } from "./xHandle.js";

export type AuthUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  onboardingCompletedAt: string | null;
  agenda: string | null;
  xUsername: string | null;
};

const USER_COLUMNS =
  "id, email, display_name, avatar_url, created_at, last_login_at, onboarding_completed_at, agenda, x_username";

type UserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  last_login_at: string | null;
  onboarding_completed_at: string | null;
  agenda: string | null;
  x_username: string | null;
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

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    onboardingCompletedAt: row.onboarding_completed_at,
    agenda: row.agenda,
    xUsername: row.x_username,
  };
}

export function toPublicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    agenda: user.agenda,
    xUsername: user.xUsername,
  };
}

export function getXOauthUsername(userId: string): string | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT username FROM oauth_accounts
       WHERE user_id = ? AND provider = 'x' AND username IS NOT NULL
       LIMIT 1`,
    )
    .get(userId) as { username: string | null } | undefined;
  return parseXHandle(row?.username ?? "") ?? null;
}

function stampXUsername(
  database: ReturnType<typeof getPlatformDb>,
  userId: string,
  username: string | null | undefined,
): void {
  const handle = parseXHandle(username ?? "");
  if (!handle) return;
  database
    .prepare(`UPDATE users SET x_username = ? WHERE id = ?`)
    .run(handle, userId);
}

export function getUserById(id: string): AuthUser | null {
  const row = getPlatformDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  return row ? mapUser(row) : null;
}

export function getUserByEmail(email: string): AuthUser | null {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const row = getPlatformDb()
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
    .get(normalized) as UserRow | undefined;
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
          opts.emailVerified ? email : null,
          opts.displayName ?? null,
          opts.avatarUrl ?? null,
          at,
          existing.userId,
        );
      database
        .prepare(
          `UPDATE oauth_accounts SET email = ?, username = ? WHERE id = ?`,
        )
        .run(opts.emailVerified ? email : null, opts.username ?? null, existing.id);
      stampXUsername(database, existing.userId, opts.username);
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
    stampXUsername(database, userId, opts.username);

    const user = getUserById(userId);
    if (!user) throw new Error("oauth user missing after insert");
    return user;
  });
  return upsert();
}

/**
 * Attach a provider identity to an already-signed-in user (e.g. Google session + X).
 * Fails if that provider account is already owned by a different real user; an
 * email-less X-only owner is adopted so a later Google login can reclaim it,
 * unless it holds a live Stripe subscription, whose billing must stay attached.
 */
export function linkOauthToUser(opts: {
  userId: string;
  provider: "google" | "x";
  providerUserId: string;
  email?: string | null;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}): { ok: true; user: AuthUser } | { ok: false; error: "already_linked" | "user_missing" } {
  const user = getUserById(opts.userId);
  if (!user) return { ok: false, error: "user_missing" };
  let existing = findOauthAccount(opts.provider, opts.providerUserId);
  if (existing && existing.userId !== opts.userId) {
    const owner = getUserById(existing.userId);
    if (owner && owner.email === null) {
      const orphanUserId = existing.userId;
      // A paying orphan must keep its billing row — deleting it would detach
      // a live Stripe subscription and leave the app charging the wrong user.
      const orphanBilling = getUserBilling(orphanUserId);
      if (orphanBilling && hasLiveStripeSubscription(orphanBilling)) {
        return { ok: false, error: "already_linked" };
      }
      const database = getPlatformDb();
      database.transaction(() => {
        database
          .prepare(`UPDATE oauth_accounts SET user_id = ? WHERE user_id = ?`)
          .run(opts.userId, orphanUserId);
        database
          .prepare(`DELETE FROM sessions WHERE user_id = ?`)
          .run(orphanUserId);
        database
          .prepare(`DELETE FROM user_billing WHERE user_id = ?`)
          .run(orphanUserId);
        database.prepare(`DELETE FROM users WHERE id = ?`).run(orphanUserId);
      })();
      existing = findOauthAccount(opts.provider, opts.providerUserId);
    } else {
      return { ok: false, error: "already_linked" };
    }
  }
  if (existing) {
    const { userId: _userId, ...rest } = opts;
    upsertOauthUser({
      ...rest,
      emailVerified: Boolean(opts.email),
    });
    const updated = getUserById(opts.userId);
    if (!updated) return { ok: false, error: "user_missing" };
    return { ok: true, user: updated };
  }
  const email = opts.email?.trim().toLowerCase() || null;
  const at = nowIso();
  const database = getPlatformDb();
  try {
    const updated = database.transaction((): AuthUser => {
      database
        .prepare(
          `INSERT INTO oauth_accounts
             (id, user_id, provider, provider_user_id, email, username, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          opts.userId,
          opts.provider,
          opts.providerUserId,
          email,
          opts.username ?? null,
          at,
        );
      database
        .prepare(
          `UPDATE users SET
             display_name = COALESCE(?, display_name),
             avatar_url = COALESCE(?, avatar_url),
             last_login_at = ?
           WHERE id = ?`,
        )
        .run(opts.displayName ?? null, opts.avatarUrl ?? null, at, opts.userId);
      stampXUsername(database, opts.userId, opts.username);
      const row = getUserById(opts.userId);
      if (!row) throw new Error("oauth user missing after insert");
      return row;
    })();
    return { ok: true, user: updated };
  } catch (err) {
    // A concurrent callback can win the UNIQUE(provider, provider_user_id)
    // race after our existence check. Surface it as already_linked, not a 500.
    const code = err instanceof Error ? (err as { code?: unknown }).code : undefined;
    if (typeof code !== "string" || !code.startsWith("SQLITE_CONSTRAINT")) {
      throw err;
    }
    return { ok: false, error: "already_linked" };
  }
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

/** Save the chosen agenda and mark first-run setup done (idempotent). */
export function completeOnboarding(
  userId: string,
  agenda: string,
  opts?: { xUsername?: string | null },
): AuthUser | null {
  const trimmed = agenda.trim();
  const at = nowIso();
  const handle = parseXHandle(opts?.xUsername ?? "") ?? null;
  const result = getPlatformDb()
    .prepare(
      `UPDATE users SET
         agenda = ?,
         onboarding_completed_at = COALESCE(onboarding_completed_at, ?),
         x_username = COALESCE(?, x_username)
       WHERE id = ?`,
    )
    .run(trimmed, at, handle, userId);
  if (result.changes === 0) return null;
  return getUserById(userId);
}

export function userNeedsXHandle(user: AuthUser): boolean {
  if (parseXHandle(user.xUsername ?? "")) return false;
  return !getXOauthUsername(user.id);
}
