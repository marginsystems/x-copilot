import { REPLY_PACE_LEAD } from "../lib/replyPace";

export function ScoutedPaceCover(props: {
  clock: string;
  onBypass: () => void;
}) {
  return (
    <div className="scouted-pace-cover" role="status">
      <p className="reply-pace-clock">{props.clock}</p>
      <p>{REPLY_PACE_LEAD} Scouted waits so you do not stack replies.</p>
      <button type="button" className="primary" onClick={props.onBypass}>
        Bypass
      </button>
    </div>
  );
}
