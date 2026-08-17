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
import { VOICE_UNLOCK_MIN_CONVERSATIONS } from "./voiceStore.js";

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
const SESSION_META_UA_MAX = 512;
const SESSION_META_IP_MAX = 128;
const LAST_SEEN_THROTTLE_MS = 60_000;

export type SessionClientMeta = {
  ip?: string | null;
  userAgent?: string | null;
};

export type LinkedOauthProvider = {
  provider: "google" | "x";
  username: string | null;
  email: string | null;
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
 * scans. Prefers the verified X oauth identity (a real X login) over a handle
 * merely claimed during onboarding.
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
  if (oauth?.user_id) return oauth.user_id;
  const user = getPlatformDb()
    .prepare(
      `SELECT id FROM users
       WHERE x_username IS NOT NULL
         AND (lower(TRIM(x_username)) = ? OR lower(TRIM(x_username)) = '@' || ?)
       LIMIT 1`,
    )
    .get(key, key) as { id: string } | undefined;
  return user?.id ?? null;
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
       WHERE (u.x_username IS NOT NULL AND TRIM(u.x_username) != '')
          OR oa.user_id IS NOT NULL
          OR (vp.conversation_count >= ? AND vp.card_json IS NULL)
       ORDER BY (vp.last_pull_at IS NULL) DESC, vp.last_pull_at ASC`,
    )
    .all(VOICE_UNLOCK_MIN_CONVERSATIONS) as UserRow[];
  return rows.map(mapUser);
}
