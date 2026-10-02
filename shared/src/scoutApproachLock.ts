import { isRecord } from "./typeGuards";

export const SCOUT_APPROACH_LOCK_PATH = "/api/scout-approach-lock";

export type ScoutApproachLockCard = {
  id: string;
  conversationId: string | null;
  inReplyToId: string | null;
  surface: "reply" | "repost" | null;
  author: string | null;
  url: string | null;
  text: string | null;
};

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

export function parseScoutApproachLockCard(raw: unknown): ScoutApproachLockCard | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || !raw.id) return null;
  const { conversationId, inReplyToId, surface, author, url, text } = raw;
  if (!nullableString(conversationId) || !nullableString(inReplyToId)) return null;
  if (!nullableString(author) || !nullableString(url) || !nullableString(text)) return null;
  if (surface !== null && surface !== "reply" && surface !== "repost") return null;
  return { id: raw.id, conversationId, inReplyToId, surface, author, url, text };
}

export function parseScoutApproachLockResponse(
  raw: unknown,
): { card: ScoutApproachLockCard | null } | null {
  if (!isRecord(raw) || raw.ok !== true) return null;
  if (raw.card === null) return { card: null };
  const card = parseScoutApproachLockCard(raw.card);
  return card ? { card } : null;
}
