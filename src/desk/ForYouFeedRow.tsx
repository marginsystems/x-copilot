import {
  FYP_LAND_TIP,
  FYP_NEXT_TIP,
  FYP_OPEN_TIP,
  FYP_WAIT_COPY,
  X_FOR_YOU_URL,
} from "../lib/forYou";
import { DeskRow } from "./DeskRow";

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
        <a
          className="primary has-tip"
          href={X_FOR_YOU_URL}
          target="_blank"
          rel="noreferrer"
          data-tip={FYP_OPEN_TIP}
        >
          Open For You
        </a>
        {props.onNext ? (
          <button
            type="button"
            className="ghost has-tip"
            onClick={props.onNext}
            data-tip={FYP_NEXT_TIP}
          >
            Next
          </button>
        ) : null}
        {props.searching ? (
          <button
            type="button"
            className="ghost has-tip"
            onClick={props.onStopScout}
            data-tip={FYP_LAND_TIP}
          >
            Land
          </button>
        ) : null}
      </div>
    </DeskRow>
  );
}
