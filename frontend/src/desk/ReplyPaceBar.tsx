import { LEARN_GIVE_HEADING, LEARN_GIVE_PATH } from "../lib/learn";
import { REPLY_PACE_HELP, REPLY_PACE_LEAD } from "../lib/replyPace";
import { DeskRow } from "./DeskRow";

export function ReplyPaceBar(props: {
  clock: string;
  remainingMs: number;
  onBypass: () => void;
}) {
  return (
    <DeskRow
      className="reply-pace-bar"
      lead={props.clock}
      leadTitle="Reply-minute timer"
      leadClassName="reply-pace-clock"
      summary={REPLY_PACE_LEAD}
      onBypass={props.onBypass}
      bypassLabel={props.remainingMs > 0 ? "Bypass" : "Back on deck"}
    >
      <details className="reply-pace-help">
        <summary aria-label="Why the hold">?</summary>
        <div className="reply-pace-help-panel">
          <p>{REPLY_PACE_HELP}</p>
          <p>
            <a href={LEARN_GIVE_PATH}>Read more — {LEARN_GIVE_HEADING}</a>
          </p>
        </div>
      </details>
    </DeskRow>
  );
}
