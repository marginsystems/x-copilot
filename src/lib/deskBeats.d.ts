import type { DeskBeats } from "./deskPhase";

export function onReplyMarked(beats: DeskBeats): DeskBeats;
export function onOriginalPosted(beats: DeskBeats): DeskBeats;
export function setForkChoice(
  beats: DeskBeats,
  choice: "original" | "reply",
): DeskBeats;
