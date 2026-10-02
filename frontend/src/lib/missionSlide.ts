import type {
  ApproachCardInput,
  ApproachPresentation,
} from "../../../shared/src/approachPresenter";

/** Keep in sync with 12-threads.css mission-slide animations. */
export const MISSION_SLIDE_MS = 420;

export function missionSlideKey(
  view: Pick<ApproachPresentation, "kind" | "gate">,
  input: {
    scout: Pick<NonNullable<ApproachCardInput["scout"]>, "id"> | null;
    suggestion: Pick<NonNullable<ApproachCardInput["suggestion"]>, "id"> | null;
  },
): string {
  switch (view.kind) {
    case "scout":
      return `scout:${input.scout?.id ?? ""}`;
    case "suggested":
      return `suggested:${input.suggestion?.id ?? ""}`;
    case "gate":
      return `gate:${view.gate ?? ""}`;
    default:
      return view.kind;
  }
}
