/** Pure UTC-day desk beat transitions. */

import type { DeskBeats } from "./deskPhase";

export function onReplyMarked(beats: DeskBeats): DeskBeats {
  if (beats.forkChoice === "reply" && !beats.forkDone) {
    return { ...beats, forkDone: true };
  }
  if (!beats.scoutReplyDone) {
    return { ...beats, scoutReplyDone: true };
  }
  if (!beats.organicReplyDone) {
    return { ...beats, organicReplyDone: true };
  }
  return beats;
}

export function onOriginalPosted(beats: DeskBeats): DeskBeats {
  if (beats.forkChoice === "original" && !beats.forkDone) {
    return { ...beats, forkDone: true };
  }
  return beats;
}

export function setForkChoice(
  beats: DeskBeats,
  choice: "original" | "reply",
): DeskBeats {
  if (
    beats.organicReplyDone &&
    beats.forkChoice === null &&
    !beats.forkDone
  ) {
    return { ...beats, forkChoice: choice };
  }
  return beats;
}
