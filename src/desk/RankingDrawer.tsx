import {
  LEARN_DRAWER_HEADING,
  LEARN_DRAWER_LEAD,
  LEARN_DRAWER_OON,
  LEARN_DRAWER_SOURCE,
  LEARN_FOLLOW_HEADING,
  LEARN_HEADING,
  LEARN_REPLY_HEADING,
  LEARN_VOLUME_HEADING,
} from "../lib/learn";

export function RankingDrawer() {
  return (
    <details className="ranking-drawer">
      <summary aria-label={LEARN_DRAWER_HEADING}>?</summary>
      <p>{LEARN_DRAWER_LEAD}</p>
      <p>{LEARN_DRAWER_OON}</p>
      <p>{LEARN_DRAWER_SOURCE}</p>
      <p className="ranking-drawer-links">
        <a href="/learn/what-a-like-is-worth">{LEARN_HEADING}</a>
        <a href="/learn/posts-that-get-a-reply">{LEARN_REPLY_HEADING}</a>
        <a href="/learn/how-many-replies">{LEARN_VOLUME_HEADING}</a>
        <a href="/learn/follow">{LEARN_FOLLOW_HEADING}</a>
      </p>
    </details>
  );
}
