import { parseOwnActivity, type OwnActivity } from "../../../shared/src/coaching";
import { isRecord } from "../../../shared/src/typeGuards";

export type DeskDetector = "for_you" | "scout";

export const DESK_DETECTOR_FALLBACK_MS = 5_000;

export type DeskDetectorRoute = {
  active: DeskDetector | null;
  check: Record<DeskDetector, () => void | Promise<void>>;
  forYouOwnPost: (activity: OwnActivity) => void;
  ownOriginal?: (activity: OwnActivity) => void;
};

export function approachDetector(
  detector: DeskDetector | null,
  lockedCardId: string | null,
): DeskDetector | null {
  if (detector === "for_you") return detector;
  if (detector === "scout" && lockedCardId) return detector;
  return null;
}

export function deskDetectorCheck(
  route: Pick<DeskDetectorRoute, "active"> | null,
  pending: boolean,
): DeskDetector | null {
  return pending ? null : route?.active ?? null;
}

export function deskFallbackTickDue(visibility: DocumentVisibilityState): boolean {
  return visibility === "visible";
}

export function deskCatchUpDue(
  route: Pick<DeskDetectorRoute, "active"> | null,
  visibility: DocumentVisibilityState,
  inFlight: boolean,
): boolean {
  return deskFallbackTickDue(visibility) && !inFlight && deskDetectorCheck(route, false) !== null;
}

export function confirmedOriginal(data: unknown, activity: OwnActivity): boolean {
  return activity.kind === "original" && isRecord(data) && data.provisional !== true;
}

export function routeOwnPostWake(
  route: Pick<DeskDetectorRoute, "forYouOwnPost" | "ownOriginal"> | null,
  data: unknown,
): OwnActivity | null {
  const activity = parseOwnActivity(data);
  if (!route || !activity?.id.trim() || !Number.isFinite(Date.parse(activity.postedAt))) {
    return null;
  }
  route.forYouOwnPost(activity);
  if (confirmedOriginal(data, activity)) route.ownOriginal?.(activity);
  return activity;
}
