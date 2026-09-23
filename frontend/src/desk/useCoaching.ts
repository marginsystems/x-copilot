import { useRef, useState } from "react";
import {
  fetchCoaching,
  mergeCoachingState,
  type CoachingFetchOptions,
  type CoachingState,
} from "../lib/coaching";
import { peekDeskBootCache } from "../lib/deskBoot";
import { useRehydrateOnVisible } from "./useDeskHistory";

export function useCoaching(verifiedOwnerId: string | null) {
  const [coaching, setCoaching] = useState<CoachingState | null>(
    () => peekDeskBootCache(verifiedOwnerId)?.desk?.coaching ?? null,
  );
  const requestSeqRef = useRef(0);

  function applyCoaching(next: CoachingState | null) {
    setCoaching(next);
  }

  async function hydrateCoaching(opts?: CoachingFetchOptions) {
    const seq = ++requestSeqRef.current;
    const next = await fetchCoaching(opts);
    if (seq !== requestSeqRef.current) return;
    if (!next) return;
    setCoaching((current) => mergeCoachingState(current, next, opts));
  }

  useRehydrateOnVisible(hydrateCoaching);

  return { coaching, applyCoaching, hydrateCoaching };
}
