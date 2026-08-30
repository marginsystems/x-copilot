import { LEARN_GIVE_HEADING, LEARN_GIVE_PATH } from "../lib/learn";
import { REPLY_PACE_HELP, REPLY_PACE_LEAD } from "../lib/replyPace";

export function ReplyPaceBar(props: {
  clock: string;
  onBypass: () => void;
}) {
  return (
    <div className="reply-pace-bar">
      <p className="reply-pace-clock">{props.clock}</p>
      <p className="reply-pace-copy">{REPLY_PACE_LEAD}</p>
      <button type="button" className="ghost" onClick={props.onBypass}>
        Bypass
      </button>
      <details className="reply-pace-help">
        <summary aria-label="Why the hold">?</summary>
        <div className="reply-pace-help-panel">
          <p>{REPLY_PACE_HELP}</p>
          <p>
            <a href={LEARN_GIVE_PATH}>Read more — {LEARN_GIVE_HEADING}</a>
          </p>
        </div>
      </details>
    </div>
  );
}
