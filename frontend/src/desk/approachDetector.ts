import { parseOwnActivity, type OwnActivity } from "../lib/coaching";

export type DeskDetector = "for_you" | "scout";

export const DESK_DETECTOR_FALLBACK_MS = 5_000;

export type DeskDetectorRoute = {
  active: DeskDetector | null;
  check: Record<DeskDetector, () => void | Promise<void>>;
  forYouOwnPost: (activity: OwnActivity) => void;
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

export function routeOwnPostWake(
  route: Pick<DeskDetectorRoute, "forYouOwnPost"> | null,
  data: unknown,
): OwnActivity | null {
  const activity = parseOwnActivity(data);
  if (!route || !activity?.id.trim() || !Number.isFinite(Date.parse(activity.postedAt))) {
    return null;
  }
  route.forYouOwnPost(activity);
  return activity;
}
