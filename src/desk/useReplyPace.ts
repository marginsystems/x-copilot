import { useEffect, useState } from "react";
import {
  formatReplyPaceClock,
  REPLY_PACE_EVENT,
  replyPaceLocked,
  replyPaceRemainingMs,
} from "../lib/replyPace";
import { clearReplyPace, readReplyPaceUntil } from "./replyPaceStore";

export function useReplyPace() {
  const [until, setUntil] = useState<number | null>(readReplyPaceUntil);
  const [now, setNow] = useState(() => Date.now());
  const remainingMs = replyPaceRemainingMs(until, now);
  const locked = remainingMs > 0;

  useEffect(() => {
    function sync() {
      setUntil(readReplyPaceUntil());
      setNow(Date.now());
    }
    window.addEventListener(REPLY_PACE_EVENT, sync);
    return () => window.removeEventListener(REPLY_PACE_EVENT, sync);
  }, []);

  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [locked]);

  useEffect(() => {
    if (until != null && !replyPaceLocked(until, now)) clearReplyPace();
  }, [until, now]);

  return {
    locked,
    remainingMs,
    clock: formatReplyPaceClock(remainingMs),
    bypass: clearReplyPace,
  };
}
