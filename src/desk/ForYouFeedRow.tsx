import {
  FYP_LAND_TIP,
  FYP_NEXT_TIP,
  FYP_OPEN_TIP,
  FYP_WAIT_COPY,
  X_FOR_YOU_URL,
} from "../lib/forYou";
import { DeskRow } from "./DeskRow";
import { HasTipButton, HasTipLink } from "./HasTip";

export function ForYouFeedRow(props: {
  searching?: boolean;
  onNext?: () => void;
  onStopScout?: () => void;
}) {
  return (
    <DeskRow
      className="for-you-row next-action-row kind-reply"
      open
      expandable
      lead="FY"
      leadTitle="Real X For You"
      leadClassName="bait kind-reply"
      summary={FYP_WAIT_COPY}
      meta={
        <>
          <span className="chip">For You</span>
          <span>x.com/home</span>
        </>
      }
    >
      <div className="row">
        <HasTipLink
          className="primary"
          href={X_FOR_YOU_URL}
          target="_blank"
          rel="noreferrer"
          tip={FYP_OPEN_TIP}
        >
          Open For You
        </HasTipLink>
        {props.onNext ? (
          <HasTipButton className="ghost" onClick={props.onNext} tip={FYP_NEXT_TIP}>
            Next
          </HasTipButton>
        ) : null}
        {props.searching ? (
          <HasTipButton
            className="ghost"
            onClick={props.onStopScout}
            tip={FYP_LAND_TIP}
          >
            Land
          </HasTipButton>
        ) : null}
      </div>
    </DeskRow>
  );
}
