/**
 * Verified X identity and write credentials on oauth_accounts.
 */
import type { AuthUser } from "./authStore.js";
import { getPlatformDb } from "./db.js";
import { parseXHandle } from "./xHandle.js";

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

export function stampXUsername(
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
