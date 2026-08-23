/**
 * OAuth account identities in the platform SQLite DB.
 */
import { randomUUID } from "node:crypto";
import {
  getUserByEmail,
  getUserById,
  type AuthUser,
} from "./authStore.js";
import { getUserBilling } from "./billingStore.js";
import { hasLiveStripeSubscription } from "./planResolution.js";
import { getPlatformDb } from "./db.js";
import { stampXUsername } from "./xIdentityStore.js";

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
