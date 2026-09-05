import { useState } from "react";
import {
  FYP_ACTION_COPY,
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
}) {
  const [open, setOpen] = useState(true);
  return (
    <DeskRow
      className="for-you-row next-action-row kind-reply"
      open={open}
      expandable
      onToggle={() => setOpen((current) => !current)}
      lead="FY"
      leadTitle="Real X For You"
      leadClassName="bait kind-reply"
      summary={props.status ?? FYP_WAIT_COPY}
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
      </div>
      <p className="reason">{FYP_ACTION_COPY}</p>
    </DeskRow>
  );
}
