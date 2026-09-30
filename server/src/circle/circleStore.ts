import { isRecord } from "../platform/unknownValue.js";
import { getPlatformDb } from "../db.js";
import { getXOauthUsername } from "../auth/xIdentityStore.js";
import { parseXHandle } from "../auth/xHandle.js";
import { normalizeAuthorKey } from "../desk/interactionCooldown.js";
import { isCircleAuthorKey } from "./circleStats.js";
import type { XProfile } from "./xProfiles.js";

export type CircleLinkKind = "reply" | "quote";

export type CircleLink = {
  postId: string;
  authorKey: string;
  kind: CircleLinkKind;
  at: string;
};

export function circleSelfHandle(userId: string): string | null {
  const oauth = getXOauthUsername(userId);
  if (oauth) return oauth;
  const row: unknown = getPlatformDb()
    .prepare(`SELECT x_username FROM users WHERE id = ?`)
    .get(userId);
  return isRecord(row) ? parseXHandle(row.x_username) : null;
}

export function upsertXProfiles(profiles: readonly XProfile[]): number {
  const rows = profiles.filter((p) => p.authorKey && p.handle);
  if (rows.length === 0) return 0;
  const db = getPlatformDb();
  const stmt = db.prepare(
    `INSERT INTO x_profiles (author_key, handle, name, avatar_url, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (author_key) DO UPDATE SET
       handle = excluded.handle,
       name = COALESCE(excluded.name, x_profiles.name),
       avatar_url = COALESCE(excluded.avatar_url, x_profiles.avatar_url),
       updated_at = excluded.updated_at`,
  );
  db.transaction(() => {
    for (const p of rows) {
      stmt.run(normalizeAuthorKey(p.authorKey), p.handle, p.name, p.avatarUrl, p.updatedAt);
    }
  })();
  return rows.length;
}

function parseProfileRow(row: unknown): XProfile | null {
  if (!isRecord(row)) return null;
  const { author_key, handle, name, avatar_url, updated_at } = row;
  if (typeof author_key !== "string" || typeof handle !== "string") return null;
  if (typeof updated_at !== "string") return null;
  return {
    authorKey: author_key,
    handle,
    name: typeof name === "string" ? name : null,
    avatarUrl: typeof avatar_url === "string" ? avatar_url : null,
    updatedAt: updated_at,
  };
}

export function getXProfiles(authorKeys: readonly string[]): Map<string, XProfile> {
  const keys = [...new Set(authorKeys.map(normalizeAuthorKey).filter(Boolean))];
  const out = new Map<string, XProfile>();
  const stmt = getPlatformDb().prepare(
    `SELECT author_key, handle, name, avatar_url, updated_at
     FROM x_profiles WHERE author_key IN (SELECT value FROM json_each(?))`,
  );
  for (let i = 0; i < keys.length; i += 500) {
    for (const row of stmt.all(JSON.stringify(keys.slice(i, i + 500)))) {
      const profile = parseProfileRow(row);
      if (profile) out.set(profile.authorKey, profile);
    }
  }
  return out;
}

export function recordCircleLinks(
  userId: string,
  links: readonly CircleLink[],
  selfHandle: string | null = circleSelfHandle(userId),
): number {
  const selfKey = selfHandle ? normalizeAuthorKey(selfHandle) : "";
  const rows = links.filter((link) => {
    const key = normalizeAuthorKey(link.authorKey);
    return isCircleAuthorKey(key, selfKey) && link.postId && (link.kind === "reply" || link.kind === "quote");
  });
  if (rows.length === 0) return 0;
  const db = getPlatformDb();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO circle_links (user_id, post_id, author_key, kind, at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  let inserted = 0;
  db.transaction(() => {
    for (const link of rows) {
      inserted += stmt.run(userId, link.postId, normalizeAuthorKey(link.authorKey), link.kind, link.at).changes;
    }
  })();
  return inserted;
}

function parseLinkRow(row: unknown): CircleLink | null {
  if (!isRecord(row)) return null;
  const { post_id, author_key, kind, at } = row;
  if (typeof post_id !== "string" || typeof author_key !== "string" || typeof at !== "string") {
    return null;
  }
  if (kind !== "reply" && kind !== "quote") return null;
  return { postId: post_id, authorKey: author_key, kind, at };
}

export const CIRCLE_LINKS_READ_MAX = 5000;

export function listCircleLinks(userId: string, limit = CIRCLE_LINKS_READ_MAX): CircleLink[] {
  return getPlatformDb()
    .prepare(
      `SELECT post_id, author_key, kind, at FROM circle_links
       WHERE user_id = ? ORDER BY at DESC, post_id DESC LIMIT ?`,
    )
    .all(userId, limit)
    .flatMap((row) => {
      const link = parseLinkRow(row);
      return link ? [link] : [];
    });
}
