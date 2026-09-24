type DetectorTarget =
  | { detector: "for_you" }
  | { detector: "scout"; cardId: string };

type DetectorSchedule = {
  target: DetectorTarget;
  intervalMs: number;
  ownPostRetryMs: number | null;
};

export function approachDetectorSchedule(
  detector: "for_you" | "scout" | null,
  lockedCardId: string | null,
): DetectorSchedule | null {
  if (detector === "for_you") {
    return {
      target: { detector },
      intervalMs: 5_000,
      ownPostRetryMs: null,
    };
  }
  if (detector === "scout" && lockedCardId) {
    return {
      target: { detector, cardId: lockedCardId },
      intervalMs: 5_000,
      ownPostRetryMs: 1_000,
    };
  }
  return null;
}

export function approachDetectorRefresh(
  schedule: DetectorSchedule | null,
  pending: boolean,
): DetectorTarget | null {
  return pending ? null : schedule?.target ?? null;
}
