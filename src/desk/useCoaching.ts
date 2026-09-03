import { useRef, useState } from "react";
import { fetchCoaching, type CoachingState } from "../lib/coaching";
import { peekDeskBootCache } from "../lib/deskBoot";
import { useRehydrateOnVisible } from "./useDeskHistory";

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
    if (!next) return;
    applyCoaching(next);
  }

  useRehydrateOnVisible(hydrateCoaching);

  return { coaching, applyCoaching, hydrateCoaching };
}
