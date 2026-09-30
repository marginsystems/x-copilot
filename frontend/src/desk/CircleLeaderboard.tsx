import { useState } from "react";
import {
  barShares,
  formatMemberCounts,
  memberInitial,
  memberScore,
} from "../lib/circleLeaderboard";
import type { CircleMember } from "../lib/circleShare";

export function CircleLeaderboard({ members }: { members: readonly CircleMember[] }) {
  const top = members.reduce((best, m) => Math.max(best, memberScore(m)), 0);
  return (
    <ol className="desk-circle-list" aria-label="Closest">
      {members.map((m, i) => {
        const shares = barShares(m, top);
        const counts = formatMemberCounts(m);
        return (
          <li key={m.handle} className={i === 0 ? "is-first" : undefined}>
            <span className="desk-circle-rank" aria-hidden="true">
              {i + 1}
            </span>
            <CircleAvatar member={m} />
            <span className="desk-circle-who">
              <a href={`https://x.com/${m.handle}`} target="_blank" rel="noreferrer">
                @{m.handle}
              </a>
              {m.name ? <span className="desk-circle-name">{m.name}</span> : null}
            </span>
            <span className="desk-circle-bar" aria-hidden="true">
              <span className="desk-circle-bar-replies" style={{ width: `${shares.replyPct}%` }} />
              <span className="desk-circle-bar-quotes" style={{ width: `${shares.quotePct}%` }} />
            </span>
            <span
              className="desk-circle-score"
              title={`${m.replies} replies, ${m.quotes} quotes`}
            >
              {counts}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function CircleAvatar({ member }: { member: CircleMember }) {
  const [failed, setFailed] = useState(false);
  if (member.avatarUrl && !failed) {
    return (
      <img
        className="desk-circle-avatar"
        src={member.avatarUrl}
        alt=""
        width={20}
        height={20}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="desk-circle-avatar is-initial" aria-hidden="true">
      {memberInitial(member.handle, member.name)}
    </span>
  );
}
