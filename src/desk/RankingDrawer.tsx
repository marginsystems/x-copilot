import { useEffect, useRef } from "react";
import {
  LEARN_DRAWER_HEADING,
  LEARN_DRAWER_LEAD,
  LEARN_DRAWER_OON,
  LEARN_DRAWER_SOURCE,
  LEARN_FOLLOW_HEADING,
  LEARN_GIVE_HEADING,
  LEARN_HEADING,
  LEARN_REPLY_HEADING,
  LEARN_VOLUME_HEADING,
} from "../lib/learn";

export function RankingDrawer() {
  const rootRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function close() {
      const el = rootRef.current;
      if (el?.open) el.open = false;
    }
    function onPointerDown(ev: PointerEvent) {
      const el = rootRef.current;
      const target = ev.target;
      if (!el?.open || !(target instanceof Node) || el.contains(target)) return;
      close();
    }
    function onKeyDown(ev: KeyboardEvent) {
      if (ev.key === "Escape") close();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <details ref={rootRef} className="ranking-drawer">
      <summary aria-label={LEARN_DRAWER_HEADING}>?</summary>
      <div className="ranking-drawer-panel">
        <p>{LEARN_DRAWER_LEAD}</p>
        <p>{LEARN_DRAWER_OON}</p>
        <p>{LEARN_DRAWER_SOURCE}</p>
        <p className="ranking-drawer-links">
          <a href="/learn/what-a-like-is-worth">{LEARN_HEADING}</a>
          <a href="/learn/posts-that-get-a-reply">{LEARN_REPLY_HEADING}</a>
          <a href="/learn/how-many-replies">{LEARN_VOLUME_HEADING}</a>
          <a href="/learn/likes-and-follows-you-give">{LEARN_GIVE_HEADING}</a>
          <a href="/learn/follow">{LEARN_FOLLOW_HEADING}</a>
        </p>
      </div>
    </details>
  );
}
