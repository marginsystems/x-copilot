/**
 * SQL-ranked digest for the daily For You pass.
 * No extra X API. own_posts + memories + leftover Scout only.
 */
import { getUserById } from "./authStore.js";
import { getPlatformDb } from "./db.js";
import { formatOutcomeSection } from "./knowledgeMemory.js";
import { listInteractionHistory } from "./interactionStore.js";
import { getLastScout } from "./scoutCache.js";
import { getVoiceProfile } from "./voiceStore.js";
import { parseVoiceCardJson, type VoiceCard } from "./voiceLlm.js";
import { FOR_YOU_KINDS, type ForYouDraft, type ForYouKind } from "./forYouStore.js";
import type { OwnPostKind } from "./xActivity.js";

export const MIN_T24H_SNAPSHOTS = 5;
const CLIP = 200;

export type DigestPost = {
  id: string;
  kind: OwnPostKind | string;
  text: string | null;
  url: string | null;
  views: number;
  likes: number;
  replies: number;
  retweets: number;
  postedAt: string;
};

export type DigestMemory = {
  threadId: string;
  author: string;
  url?: string;
  reply?: string;
  outcome?: string;
};

export type DigestScout = {
  id: string;
  author: string;
  text: string;
  url: string;
  summary?: string;
};

export type ForYouDigest = {
  agenda: string | null;
  voice: VoiceCard | null;
  best: DigestPost[];
  worst: DigestPost[];
  recentOriginals: DigestPost[];
  recentReplies: DigestPost[];
  recentQuotes: DigestPost[];
  memories: DigestMemory[];
  leftoverScout: DigestScout[];
};

export function countT24hSnapshots(userId: string): number {
  const row = getPlatformDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM own_posts
       WHERE user_id = ? AND t24h_at IS NOT NULL`,
    )
    .get(userId) as { n: number };
  return Number(row.n) || 0;
}

export function listEligibleForYouUsers(): Array<{
  userId: string;
  tenantId: string;
}> {
  return getPlatformDb()
    .prepare(
      `SELECT user_id AS userId, MIN(tenant_id) AS tenantId
       FROM own_posts
       WHERE t24h_at IS NOT NULL
       GROUP BY user_id
       HAVING COUNT(*) >= ?`,
    )
    .all(MIN_T24H_SNAPSHOTS) as Array<{ userId: string; tenantId: string }>;
}

function clip(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  return t.length > CLIP ? `${t.slice(0, CLIP)}…` : t;
}

function mapPost(row: Record<string, unknown>): DigestPost {
  return {
    id: String(row.id),
    kind: String(row.kind),
    text: clip((row.text as string | null) ?? null),
    url: (row.url as string | null) ?? null,
    views: Number(row.views ?? 0),
    likes: Number(row.likes ?? 0),
    replies: Number(row.replies ?? 0),
    retweets: Number(row.retweets ?? 0),
    postedAt: String(row.posted_at),
  };
}

export function rankOwnPosts(userId: string): {
  best: DigestPost[];
  worst: DigestPost[];
  recentOriginals: DigestPost[];
  recentReplies: DigestPost[];
  recentQuotes: DigestPost[];
} {
  const db = getPlatformDb();
  const scored = db
    .prepare(
      `SELECT id, kind, text, url, posted_at,
         COALESCE(t24h_views, 0) AS views,
         COALESCE(t24h_likes, 0) AS likes,
         COALESCE(t24h_replies, 0) AS replies,
         COALESCE(t24h_retweets, 0) AS retweets
       FROM own_posts
       WHERE user_id = ? AND t24h_at IS NOT NULL
       ORDER BY views DESC`,
    )
    .all(userId) as Array<Record<string, unknown>>;
  const mapped = scored.map(mapPost);
  const best = mapped.slice(0, 5);
  const worst = [...mapped].reverse().slice(0, 5);

  const recentKind = (kind: OwnPostKind): DigestPost[] =>
    (
      db
        .prepare(
          `SELECT id, kind, text, url, posted_at,
             COALESCE(t24h_views, t1h_views, t0_views, 0) AS views,
             COALESCE(t24h_likes, t1h_likes, t0_likes, 0) AS likes,
             COALESCE(t24h_replies, t1h_replies, t0_replies, 0) AS replies,
             COALESCE(t24h_retweets, t1h_retweets, t0_retweets, 0) AS retweets
           FROM own_posts
           WHERE user_id = ? AND kind = ?
           ORDER BY posted_at DESC
           LIMIT 3`,
        )
        .all(userId, kind) as Array<Record<string, unknown>>
    ).map(mapPost);

  return {
    best,
    worst,
    recentOriginals: recentKind("original"),
    recentReplies: recentKind("reply"),
    recentQuotes: recentKind("quote"),
  };
}

export async function buildForYouDigest(opts: {
  userId: string;
  getScout?: () => Promise<{ threads?: DigestScout[] } | null>;
}): Promise<ForYouDigest> {
  const user = getUserById(opts.userId);
  const profile = getVoiceProfile(opts.userId);
  const voice = profile?.cardJson
    ? parseVoiceCardJson(profile.cardJson)
    : null;
  const ranked = rankOwnPosts(opts.userId);
  const history = await listInteractionHistory({
    userId: opts.userId,
    limit: 5,
  });
  const memories: DigestMemory[] = history.map((row) => ({
    threadId: row.threadId,
    author: row.author,
    url: row.url,
    reply: clip(row.text) ?? undefined,
    outcome: row.stats ? formatOutcomeSection(row.stats) : undefined,
  }));
  const scout = opts.getScout
    ? await opts.getScout()
    : await getLastScout();
  const leftoverScout: DigestScout[] = (scout?.threads ?? [])
    .filter((t) => t.id && t.url && t.author)
    .slice(0, 8)
    .map((t) => ({
      id: t.id,
      author: t.author,
      text: clip(t.text) ?? "",
      url: t.url,
      summary: clip(t.summary) ?? undefined,
    }));
  return {
    agenda: user?.agenda?.trim() || null,
    voice,
    ...ranked,
    memories,
    leftoverScout,
  };
}

export function digestAllowlist(digest: ForYouDigest): {
  ids: Set<string>;
  urls: Set<string>;
} {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const add = (id?: string | null, url?: string | null) => {
    if (id?.trim()) ids.add(id.trim());
    if (url?.trim()) urls.add(url.trim());
  };
  for (const p of [
    ...digest.best,
    ...digest.worst,
    ...digest.recentOriginals,
    ...digest.recentReplies,
    ...digest.recentQuotes,
  ]) {
    add(p.id, p.url);
  }
  for (const m of digest.memories) add(m.threadId, m.url);
  for (const t of digest.leftoverScout) add(t.id, t.url);
  return { ids, urls };
}

function asKind(value: unknown): ForYouKind | null {
  return typeof value === "string" &&
    (FOR_YOU_KINDS as readonly string[]).includes(value)
    ? (value as ForYouKind)
    : null;
}

/**
 * Keep 2–4 actions whose targets exist in the digest.
 * `post` needs a draft and no invented target. Others need a known target.
 */
export function filterDigestActions(
  raw: unknown,
  digest: ForYouDigest,
): ForYouDraft[] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(obj?.actions) ? obj.actions : [];
  const { ids, urls } = digestAllowlist(digest);
  const out: ForYouDraft[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const kind = asKind(row.kind);
    const why = typeof row.why === "string" ? row.why.trim() : "";
    if (!kind || !why) continue;
    const draft =
      typeof row.draft === "string" && row.draft.trim()
        ? row.draft.trim().slice(0, 560)
        : null;
    const targetId =
      typeof row.targetId === "string"
        ? row.targetId.trim()
        : typeof row.target_id === "string"
          ? row.target_id.trim()
          : "";
    const targetUrl =
      typeof row.targetUrl === "string"
        ? row.targetUrl.trim()
        : typeof row.target_url === "string"
          ? row.target_url.trim()
          : "";
    const targetAuthor =
      typeof row.targetAuthor === "string"
        ? row.targetAuthor.trim()
        : typeof row.target_author === "string"
          ? row.target_author.trim()
          : "";
    if (kind === "post") {
      if (!draft) continue;
      const key = `post:${draft}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, why, draft });
    } else {
      const knownId = targetId && ids.has(targetId);
      const knownUrl = targetUrl && urls.has(targetUrl);
      if (!knownId && !knownUrl) continue;
      const key = `${kind}:${targetId || targetUrl}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (kind === "quote" && !draft) continue;
      out.push({
        kind,
        why,
        draft: kind === "quote" || kind === "reply" ? draft : null,
        targetId: knownId ? targetId : null,
        targetUrl: knownUrl ? targetUrl : knownId ? null : targetUrl || null,
        targetAuthor: targetAuthor || null,
      });
    }
    if (out.length >= 4) break;
  }
  return out;
}
