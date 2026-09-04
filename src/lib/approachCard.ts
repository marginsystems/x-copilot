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

/** Reply / quote / repost first. A post only when it is earned. */
export function pickApproachSuggestion(
  rows: ForYouSuggestion[],
  opts?: { allowPost?: boolean },
): ForYouSuggestion | null {
  const paced = rows.find(isPacedSuggestion);
  if (paced) return paced;
  if (opts?.allowPost) {
    return rows.find((row) => row.kind === "post") ?? null;
  }
  return null;
}
