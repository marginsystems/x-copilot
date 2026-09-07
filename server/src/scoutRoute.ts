import { isCoolThread } from "./scoutPolicy.js";
import type { ThreadCard } from "./threadCard.js";

export const REPOST_MIN_VIEWS = 100;
export const REPOST_MIN_AGE_MS = 20 * 60 * 1000;
export const REPOST_MIN_VIEWS_PER_HOUR = 50;

export type ScoutSurface = "reply" | "repost";

export function routeScoutSurface(
  card: ThreadCard,
  nowMs: number,
): ScoutSurface {
  if (!isCoolThread(card)) return "reply";
  if (card.isReply === true || card.threadKind === "hollow_ask") return "reply";
  if (card.text.includes("?") || card.opText?.includes("?")) return "reply";

  const views = card.opViews ?? card.views;
  const createdAt = card.opCreatedAt ?? card.createdAt;
  const createdAtMs =
    typeof createdAt === "string" ? Date.parse(createdAt) : NaN;
  if (
    typeof views !== "number" ||
    !Number.isFinite(views) ||
    views < REPOST_MIN_VIEWS ||
    !Number.isFinite(createdAtMs)
  ) {
    return "reply";
  }

  const ageMs = nowMs - createdAtMs;
  if (ageMs < REPOST_MIN_AGE_MS) return "reply";
  const viewsPerHour = views / (ageMs / (60 * 60 * 1000));
  return viewsPerHour >= REPOST_MIN_VIEWS_PER_HOUR ? "repost" : "reply";
}
