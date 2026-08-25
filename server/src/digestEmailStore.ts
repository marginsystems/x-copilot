/**
 * Durable opt-in and once-per-UTC-day delivery state for Approach email.
 */
import { getPlatformDb } from "./db.js";
import { startOfUtcDayIso } from "./ownPostStore.js";

export type DigestEmailSettings = {
  email: string | null;
  optedIn: boolean;
  optedInAt: string | null;
  sentAt: string | null;
};

type DigestEmailRow = {
  email: string | null;
  digest_email_opt_in: number;
  digest_email_opt_in_at: string | null;
  digest_email_sent_at: string | null;
};

function mapSettings(row: DigestEmailRow): DigestEmailSettings {
  return {
    email: row.email,
    optedIn: row.digest_email_opt_in === 1,
    optedInAt: row.digest_email_opt_in_at,
    sentAt: row.digest_email_sent_at,
  };
}

export function getDigestEmailSettings(
  userId: string,
): DigestEmailSettings | null {
  const row = getPlatformDb()
    .prepare(
      `SELECT email, digest_email_opt_in, digest_email_opt_in_at,
              digest_email_sent_at
       FROM users
       WHERE id = ?`,
    )
    .get(userId) as DigestEmailRow | undefined;
  return row ? mapSettings(row) : null;
}

export function setDigestEmailOptIn(
  userId: string,
  optedIn: boolean,
  nowMs: number = Date.now(),
): DigestEmailSettings | null {
  const now = new Date(nowMs).toISOString();
  const result = getPlatformDb()
    .prepare(
      `UPDATE users
       SET digest_email_opt_in = ?,
           digest_email_opt_in_at = CASE WHEN ? = 1 THEN ? ELSE NULL END
       WHERE id = ? AND (? = 0 OR email IS NOT NULL)`,
    )
    .run(optedIn ? 1 : 0, optedIn ? 1 : 0, now, userId, optedIn ? 1 : 0);
  if (!result.changes) return null;
  return getDigestEmailSettings(userId);
}

export function digestEmailSentToday(
  settings: DigestEmailSettings,
  nowMs: number = Date.now(),
): boolean {
  return Boolean(
    settings.sentAt && settings.sentAt >= startOfUtcDayIso(new Date(nowMs)),
  );
}

export function markDigestEmailSent(
  userId: string,
  nowMs: number = Date.now(),
): boolean {
  const result = getPlatformDb()
    .prepare(
      `UPDATE users
       SET digest_email_sent_at = ?
       WHERE id = ? AND digest_email_opt_in = 1 AND email IS NOT NULL`,
    )
    .run(new Date(nowMs).toISOString(), userId);
  return result.changes > 0;
}
