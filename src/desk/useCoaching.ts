import { useRef, useState } from "react";
import { fetchCoaching, type CoachingState } from "../lib/coaching";
import { peekDeskBootCache } from "../lib/deskBoot";

export function useCoaching() {
  const [coaching, setCoaching] = useState<CoachingState | null>(
    () => peekDeskBootCache()?.desk?.coaching ?? null,
  );
  const requestSeqRef = useRef(0);

  function applyCoaching(next: CoachingState | null) {
    setCoaching(next);
  }

  async function hydrateCoaching() {
    const seq = ++requestSeqRef.current;
    const next = await fetchCoaching();
    if (seq !== requestSeqRef.current) return;
    applyCoaching(next);
  }

  return { coaching, applyCoaching, hydrateCoaching };
}
