import { useRef, useState } from "react";
import { fetchCoaching, type CoachingState } from "../lib/coaching";

export function useCoaching() {
  const [coaching, setCoaching] = useState<CoachingState | null>(null);
  const requestSeqRef = useRef(0);

  async function hydrateCoaching() {
    const seq = ++requestSeqRef.current;
    const next = await fetchCoaching();
    if (seq !== requestSeqRef.current) return;
    if (!next) return;
    setCoaching(next);
  }

  return { coaching, hydrateCoaching };
}
