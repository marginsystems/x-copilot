/** Pure UTC-day desk beat transitions. */

export function onReplyMarked(beats) {
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

export function onOriginalPosted(beats) {
  if (beats.forkChoice === "original" && !beats.forkDone) {
    return { ...beats, forkDone: true };
  }
  return beats;
}

export function setForkChoice(beats, choice) {
  if (
    beats.organicReplyDone &&
    beats.forkChoice === null &&
    !beats.forkDone
  ) {
    return { ...beats, forkChoice: choice };
  }
  return beats;
}
