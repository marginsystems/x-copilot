/**
 * Users in the platform SQLite DB.
 */
import { getPlatformDb } from "./db.js";
import { parseXHandle } from "./xHandle.js";
import { getXOauthUsername, hasXWriteCreds } from "./xIdentityStore.js";
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

/** Save the chosen agenda and mark first-run setup done (idempotent). */
export function completeOnboarding(
  userId: string,
  agenda: string,
): AuthUser | null {
  const trimmed = agenda.trim();
  const at = new Date().toISOString();
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

/** Update the live desk agenda without touching first-run completion. */
export function updateUserAgenda(
  userId: string,
  agenda: string,
): AuthUser | null {
  const trimmed = agenda.trim();
  const result = getPlatformDb()
    .prepare("UPDATE users SET agenda = ? WHERE id = ?")
    .run(trimmed, userId);
  if (result.changes === 0) return null;
  return getUserById(userId);
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
