import type { DailyMission } from "./coaching";
import type { ForYouSuggestion } from "./forYou";

/** A post is earned after a scouted reply today, while original_1 is still open. */
export function canServeApproachOriginal(opts: {
  scoutReplyDone: boolean;
  originalMission?: Pick<
    DailyMission,
    "progress" | "target" | "completed"
  > | null;
}): boolean {
  if (!opts.scoutReplyDone) return false;
  const mission = opts.originalMission;
  if (!mission || mission.completed) return false;
  return mission.progress < mission.target;
}

function isPacedSuggestion(row: ForYouSuggestion): boolean {
  return row.kind === "reply" || row.kind === "quote" || row.kind === "repost";
}

function targetUrlId(url: string | null): string | null {
  return url?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

/** Reply / quote / repost first. A post only when it is earned. */
export function pickApproachSuggestion(
  rows: ForYouSuggestion[],
  opts?: {
    allowPost?: boolean;
    interactedIds?: Iterable<string>;
    history?: ReadonlyArray<{
      threadId: string;
      conversationId?: string;
      inReplyToId?: string;
      url?: string;
    }>;
    lockedId?: string | null;
  },
): ForYouSuggestion | null {
  const blockedIds = new Set(opts?.interactedIds ?? []);
  const blockedUrls = new Set<string>();
  for (const row of opts?.history ?? []) {
    blockedIds.add(row.threadId);
    if (row.conversationId) blockedIds.add(row.conversationId);
    if (row.inReplyToId) blockedIds.add(row.inReplyToId);
    if (row.url) blockedUrls.add(row.url);
  }
  const paced = rows.find(
    (row) =>
      isPacedSuggestion(row) &&
      (row.id === opts?.lockedId ||
        !(
          (row.targetId && blockedIds.has(row.targetId)) ||
          (row.targetUrl && blockedUrls.has(row.targetUrl)) ||
          (targetUrlId(row.targetUrl) &&
            blockedIds.has(targetUrlId(row.targetUrl)!))
        )),
  );
  if (paced) return paced;
  if (opts?.allowPost) {
    return rows.find((row) => row.kind === "post") ?? null;
  }
  return null;
}
