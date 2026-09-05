import { useEffect, useState } from "react";
import {
  formatReplyPaceClock,
  REPLY_PACE_EVENT,
  replyPaceLocked,
  replyPaceRemainingMs,
} from "../lib/replyPace";
import {
  clearReplyPace,
  readReplyPaceUntil,
  seedReplyPaceFromReplyAt,
} from "./replyPaceStore";

export function useReplyPace(replyAtIso?: string | null) {
  const [until, setUntil] = useState<number | null>(readReplyPaceUntil);
  const [now, setNow] = useState(() => Date.now());
  const remainingMs = replyPaceRemainingMs(until, now);
  const locked = replyPaceLocked(until, now);
  const countingDown = remainingMs > 0;

  useEffect(() => {
    function sync() {
      setUntil(readReplyPaceUntil());
      setNow(Date.now());
    }
    window.addEventListener(REPLY_PACE_EVENT, sync);
    return () => window.removeEventListener(REPLY_PACE_EVENT, sync);
  }, []);

  useEffect(() => {
    const seeded = seedReplyPaceFromReplyAt(replyAtIso);
    if (seeded != null) setUntil(seeded);
  }, [replyAtIso]);

  useEffect(() => {
    if (!countingDown) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [countingDown]);

  useEffect(() => {
    if (until != null && remainingMs === 0) {
      clearReplyPace();
    }
  }, [until, remainingMs]);

  return {
    locked,
    remainingMs,
    clock: formatReplyPaceClock(remainingMs),
    bypass: clearReplyPace,
  };
}
