import {
  FYP_DETECTED_COPY,
  FYP_DETECTING_COPY,
  FYP_INSPIRATION_TIP,
  FYP_NEXT_TIP,
  FYP_OPEN_TIP,
  FYP_WAIT_COPY,
  X_FOR_YOU_URL,
  X_INSPIRATION_URL,
} from "../lib/forYou";
import type { OwnActivity } from "../lib/coaching";
import { ApproachDetectingMark } from "./ApproachFrame";
import { DeskRow } from "./DeskRow";
import type { OpenPace } from "./RowOpen";

export function ForYouFeedRow(props: {
  status?: string;
  detected?: boolean;
  activity?: OwnActivity | null;
  onNext?: () => void;
  openPace?: OpenPace | null;
}) {
  const detected = props.detected === true;
  const detecting = !detected && props.status === FYP_DETECTING_COPY;
  const summary = detected ? (
    <span className="for-you-detected-summary">
      <span>{FYP_DETECTED_COPY}</span>
      {props.activity ? (
        <>
          <span className="for-you-detected-id">{props.activity.id}</span>
          <a
            className="for-you-post-link"
            href={props.activity.url}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open detected post ${props.activity.id} on X`}
            title="Open detected post on X"
            onClick={(event) => event.stopPropagation()}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3h7v7h-1.5V5.56l-6.97 6.97-1.06-1.06 6.97-6.97H6V3Z" />
              <path d="M12 12v2H2V4h2v1.5h-.5v7h7V12H12Z" />
            </svg>
          </a>
        </>
      ) : null}
    </span>
  ) : (
    detecting ? (
      <ApproachDetectingMark />
    ) : (
      <span className="for-you-status">
        <span>{props.status ?? FYP_WAIT_COPY}</span>
      </span>
    )
  );
  return (
    <DeskRow
      className="for-you-row next-action-row kind-reply"
      lead="FY"
      leadTitle="Real X For You"
      leadClassName="bait kind-reply"
      summary={summary}
      meta={
        <>
          <span className="chip">For You</span>
          {detected ? (
            <span className="chip chip-interacted">interacted</span>
          ) : null}
          <span>x.com/home</span>
        </>
      }
      openHref={detected ? null : X_FOR_YOU_URL}
      openLabel={detected ? undefined : "Open For You"}
      openTip={FYP_OPEN_TIP}
      secondaryOpenHref={detected ? null : X_INSPIRATION_URL}
      secondaryOpenLabel={detected ? undefined : "Open Inspiration"}
      secondaryOpenTip={FYP_INSPIRATION_TIP}
      openPace={props.openPace ?? null}
      onNext={props.onNext}
      nextTip={FYP_NEXT_TIP}
    />
  );
}
