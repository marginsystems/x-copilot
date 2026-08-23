/**
 * Users and OAuth identities in the platform SQLite DB.
 */
import { randomUUID } from "node:crypto";
import {
  getUserBilling,
  hasLiveStripeSubscription,
} from "./billingStore.js";
import { getPlatformDb } from "./db.js";
import { parseXHandle } from "./xHandle.js";
import { VOICE_UNLOCK_MIN_POSTS } from "./voiceStore.js";

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

function nowIso(): string {
  return new Date().toISOString();
}

export type LinkedOauthProvider = {
  provider: "google" | "x";
  username: string | null;
  email: string | null;
};

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
  const xUsername = getXOauthUsername(user.id);
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    onboardingCompleted: Boolean(user.onboardingCompletedAt),
    agenda: user.agenda,
    xUsername,
    xLinked: Boolean(xUsername),
    xCanPost: hasXWriteCreds(user.id),
  };
}

export function getXOauthUsername(userId: string): string | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT username FROM oauth_accounts
       WHERE user_id = ? AND provider = 'x' AND username IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(userId) as { username: string | null } | undefined;
  return parseXHandle(row?.username ?? "") ?? null;
}

/** The X user id the user actually proved via OAuth (oauth_accounts row). */
export function getXOauthXUserId(userId: string): string | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT provider_user_id FROM oauth_accounts
       WHERE user_id = ? AND provider = 'x' AND provider_user_id IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(userId) as { provider_user_id: string } | undefined;
  return row?.provider_user_id?.trim() || null;
}

/**
 * Match a public handle to a desk user. Point lookups only — no full-table
 * scans. Only a verified X oauth identity (a real X login) counts; a handle
 * merely typed during onboarding is never trusted.
 */
export function findUserIdByXUsername(username: string): string | null {
  const handle = parseXHandle(username);
  if (!handle) return null;
  const key = handle.toLowerCase();
  const oauth = getPlatformDb()
    .prepare(
      `SELECT user_id FROM oauth_accounts
       WHERE provider = 'x'
         AND username IS NOT NULL
         AND (lower(TRIM(username)) = ? OR lower(TRIM(username)) = '@' || ?)
       LIMIT 1`,
    )
    .get(key, key) as { user_id: string } | undefined;
  return oauth?.user_id ?? null;
}

function stampXUsername(
  database: ReturnType<typeof getPlatformDb>,
  userId: string,
  username: string | null | undefined,
): void {
  const handle = parseXHandle(username ?? "");
  if (!handle) return;
  const row = database
    .prepare(`SELECT x_username FROM users WHERE id = ?`)
    .get(userId) as { x_username: string | null } | undefined;
  const current = parseXHandle(row?.x_username ?? "") ?? "";
  if (current && current.toLowerCase() !== handle.toLowerCase()) {
    return;
  }
  database
    .prepare(`UPDATE users SET x_username = ? WHERE id = ?`)
    .run(handle, userId);
}

/** Overwrite the public X handle used for Voice / hourly ingest. */
export function setUserXUsername(
  userId: string,
  username: string,
): AuthUser | null {
  const handle = parseXHandle(username);
  if (!handle) return null;
  const result = getPlatformDb()
    .prepare(`UPDATE users SET x_username = ? WHERE id = ?`)
    .run(handle, userId);
  if (result.changes === 0) return null;
  return getUserById(userId);
}

/** Number of platform users — the single-user sidecar folds unowned notes. */
export function countPlatformUsers(): number {
  const row = getPlatformDb()
    .prepare(`SELECT COUNT(*) AS n FROM users`)
    .get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}

/** The sole platform user's id when exactly one platform user exists
 * (single-user sidecar), else null — legacy unowned rows route to it. */
export function getSolePlatformUserId(): string | null {
  const rows = getPlatformDb()
    .prepare(`SELECT id FROM users LIMIT 2`)
    .all() as Array<{ id: string }>;
  return rows.length === 1 ? rows[0]!.id : null;
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

export type OauthUpsert = {
  user: AuthUser;
  /** True only when a new `users` row is inserted — not email-merge or re-login. */
  created: boolean;
};

export function upsertOauthIdentity(opts: {
  provider: "google" | "x";
  providerUserId: string;
  email?: string | null;
  emailVerified: boolean;
  username?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
}): OauthUpsert {
  const database = getPlatformDb();
  const email = opts.email?.trim().toLowerCase() || null;
  const at = nowIso();
  const upsert = database.transaction((): OauthUpsert => {
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
          `UPDATE oauth_accounts SET email = ?, username = ?, created_at = ? WHERE id = ?`,
        )
        .run(
          opts.emailVerified ? email : null,
          opts.username ?? null,
          at,
          existing.id,
        );
      stampXUsername(database, existing.userId, opts.username);
      const user = getUserById(existing.userId);
      if (!user) throw new Error("oauth user missing after update");
      return { user, created: false };
    }

    const byEmail = email && opts.emailVerified ? getUserByEmail(email) : null;
    const userId = byEmail?.id ?? randomUUID();
    const created = !byEmail;
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
    return { user, created };
  });
  return upsert();
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
  return upsertOauthIdentity(opts).user;
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

export function listOauthProviders(userId: string): LinkedOauthProvider[] {
  const rows = getPlatformDb()
    .prepare(
      `SELECT provider, username, email
       FROM oauth_accounts
       WHERE user_id = ?
       ORDER BY created_at ASC`,
    )
    .all(userId) as Array<{
    provider: string;
    username: string | null;
    email: string | null;
  }>;
  return rows
    .filter((row) => row.provider === "google" || row.provider === "x")
    .map((row) => ({
      provider: row.provider as "google" | "x",
      username: row.username,
      email: row.email,
    }));
}

/** Save the chosen agenda and mark first-run setup done (idempotent). */
export function completeOnboarding(
  userId: string,
  agenda: string,
): AuthUser | null {
  const trimmed = agenda.trim();
  const at = nowIso();
  const handle = getXOauthUsername(userId);
  const result = getPlatformDb()
    .prepare(
      `UPDATE users SET
         agenda = ?,
         onboarding_completed_at = COALESCE(onboarding_completed_at, ?),
         x_username = ?
       WHERE id = ?`,
    )
    .run(trimmed, at, handle, userId);
  if (result.changes === 0) return null;
  return getUserById(userId);
}

export type XWriteCreds = {
  token: string;
  secret: string;
};

export function getXWriteCreds(userId: string): XWriteCreds | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT access_token AS token, access_token_secret AS secret
         FROM oauth_accounts
        WHERE user_id = ? AND provider = 'x'
          AND access_token IS NOT NULL AND access_token != ''
          AND access_token_secret IS NOT NULL AND access_token_secret != ''
        ORDER BY created_at DESC
        LIMIT 1`,
    )
    .get(userId) as { token: string; secret: string } | undefined;
  if (!row?.token?.trim() || !row.secret?.trim()) return null;
  return { token: row.token, secret: row.secret };
}

export function hasXWriteCreds(userId: string): boolean {
  return getXWriteCreds(userId) !== null;
}

export function saveXWriteCreds(
  userId: string,
  providerUserId: string,
  creds: XWriteCreds,
): boolean {
  const token = creds.token.trim();
  const secret = creds.secret.trim();
  if (!token || !secret) return false;
  const result = getPlatformDb()
    .prepare(
      `UPDATE oauth_accounts
          SET access_token = ?,
              access_token_secret = ?,
              write_granted_at = ?
        WHERE user_id = ? AND provider = 'x' AND provider_user_id = ?`,
    )
    .run(token, secret, new Date().toISOString(), userId, providerUserId);
  return result.changes > 0;
}

/** True until official X OAuth is linked. A typed users.x_username does not count. */
export function userNeedsXHandle(user: AuthUser): boolean {
  return !getXOauthUsername(user.id);
}

/** Desk users the hourly ingest serves: handle users, plus memory-only users
 *  past the unlock bar without a card. One query, ordered least-recently-pulled
 *  first so the per-tick budget rotates instead of starving users past #20. */
export function listIngestUsers(): AuthUser[] {
  const rows = getPlatformDb()
    .prepare(
      `SELECT DISTINCT
         u.id, u.email, u.display_name, u.avatar_url, u.created_at,
         u.last_login_at, u.onboarding_completed_at, u.agenda, u.x_username
       FROM users u
       LEFT JOIN oauth_accounts oa
         ON oa.user_id = u.id AND oa.provider = 'x' AND oa.username IS NOT NULL
       LEFT JOIN voice_profiles vp ON vp.user_id = u.id
       WHERE oa.user_id IS NOT NULL
          OR (vp.reply_count >= ? AND vp.card_json IS NULL)
       ORDER BY (vp.last_pull_at IS NULL) DESC, vp.last_pull_at ASC`,
    )
    .all(VOICE_UNLOCK_MIN_POSTS) as UserRow[];
  return rows.map(mapUser);
}
