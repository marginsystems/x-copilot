import { useState } from "react";
import {
  FYP_ACTION_COPY,
  FYP_DETECTED_COPY,
  FYP_NEXT_TIP,
  FYP_OPEN_TIP,
  FYP_WAIT_COPY,
  X_FOR_YOU_URL,
} from "../lib/forYou";
import { DeskRow } from "./DeskRow";
import { HasTipButton, HasTipLink } from "./HasTip";

export function ForYouFeedRow(props: {
  status?: string;
  onNext?: () => void;
  expandable?: boolean;
}) {
  const [open, setOpen] = useState(true);
  const expandable = props.expandable ?? true;
  const detected = props.status === FYP_DETECTED_COPY;
  const summary = props.status ?? FYP_WAIT_COPY;
  return (
    <DeskRow
      className="for-you-row next-action-row kind-reply"
      open={open}
      expandable={expandable}
      onToggle={expandable ? () => setOpen((current) => !current) : undefined}
      lead="FY"
      leadTitle="Real X For You"
      leadClassName="bait kind-reply"
      summary={expandable ? summary : undefined}
      meta={
        <>
          <span className="chip">For You</span>
          <span>x.com/home</span>
        </>
      }
    >
      <div className="row">
        {detected ? null : (
          <HasTipLink
            className="primary"
            href={X_FOR_YOU_URL}
            target="_blank"
            rel="noreferrer"
            tip={FYP_OPEN_TIP}
          >
            Open For You
          </HasTipLink>
        )}
        {props.onNext ? (
          <HasTipButton
            className={detected ? "primary" : "ghost"}
            onClick={props.onNext}
            tip={FYP_NEXT_TIP}
          >
            Next
          </HasTipButton>
        ) : null}
      </div>
      {detected ? null : <p className="reason">{FYP_ACTION_COPY}</p>}
    </DeskRow>
  );
}
