import type { Interaction } from "./interactionStore.js";

export type RetainedInteraction = {
  threadId: string;
  at: string;
  url?: string;
  replyId?: string;
  replyUrl?: string;
  postedAt?: string;
  conversationId?: string;
  inReplyToId?: string;
  stats?: { t24h: { views?: number; likes?: number } };
};

const OPTIONAL_KEYS = [
  "replyId",
  "replyUrl",
  "postedAt",
  "conversationId",
  "inReplyToId",
] as const;

export function toRetainedInteraction(row: Interaction): RetainedInteraction {
  const slim: RetainedInteraction = { threadId: row.threadId, at: row.at };
  for (const key of OPTIONAL_KEYS) {
    const value = row[key];
    if (typeof value === "string" && value) slim[key] = value;
  }
  const urlId = row.url?.match(/\/status\/(\d+)/)?.[1];
  if (row.url && (!urlId || ![row.threadId, row.conversationId, row.inReplyToId].includes(urlId))) {
    slim.url = row.url;
  }
  const t24h = row.stats?.t24h;
  if (t24h) {
    const stats: { views?: number; likes?: number } = {};
    if (typeof t24h.views === "number") stats.views = t24h.views;
    if (typeof t24h.likes === "number") stats.likes = t24h.likes;
    if (stats.views !== undefined || stats.likes !== undefined) slim.stats = { t24h: stats };
  }
  return slim;
}

export function toRetainedInteractions(rows: Interaction[]): RetainedInteraction[] {
  return rows.map(toRetainedInteraction);
}
