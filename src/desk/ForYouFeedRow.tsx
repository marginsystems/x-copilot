import { FYP_WAIT_COPY, X_FOR_YOU_URL } from "../lib/forYou";
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
          className="primary"
          href={X_FOR_YOU_URL}
          target="_blank"
          rel="noreferrer"
        >
          Open For You
        </a>
        {props.onNext ? (
          <button type="button" className="ghost" onClick={props.onNext}>
            Next
          </button>
        ) : null}
        {props.searching ? (
          <button
            type="button"
            className="ghost"
            onClick={props.onStopScout}
          >
            Land
          </button>
        ) : null}
      </div>
    </DeskRow>
  );
}
