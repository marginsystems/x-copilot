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

/**
 * The real x.com/home task. Once the post is detected the row stops being
 * collapsible: Next is the only way forward and stays on screen.
 */
export function ForYouFeedRow(props: {
  status?: string;
  detected?: boolean;
  actionCopy?: string;
  onNext?: () => void;
  expandable?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const detected = props.detected === true;
  const expandable = (props.expandable ?? true) && !detected;
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
      {detected ? null : (
        <p className="reason">{props.actionCopy ?? FYP_ACTION_COPY}</p>
      )}
    </DeskRow>
  );
}
