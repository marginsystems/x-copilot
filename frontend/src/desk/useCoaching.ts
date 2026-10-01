import { useRef, useState } from "react";
import { fetchCoaching } from "../lib/fetchCoaching";
import {
  mergeCoachingState,
  mergeNextAction,
  nextActionDayMatches,
  type CoachingFetchOptions,
  type CoachingState,
} from "../../../shared/src/coaching";
import { peekDeskBootCache } from "../lib/deskBoot";
import { useRehydrateOnVisible } from "./useDeskHistory";

export function beginCoachingRequest(
  sequences: { full: number; lite: number },
  opts?: CoachingFetchOptions,
) {
  const kind = opts?.lite ? "lite" : "full";
  const seq = sequences[kind] + 1;
  return {
    sequences: { ...sequences, [kind]: seq },
    isCurrent: (current: typeof sequences) => current[kind] === seq,
  };
}

export function isNextActionRefresh(opts?: CoachingFetchOptions): boolean {
  return Boolean(opts?.nextAction && !opts.lite);
}

export function useCoaching(verifiedOwnerId: string | null) {
  const [coaching, setCoaching] = useState<CoachingState | null>(
    () => peekDeskBootCache(verifiedOwnerId)?.desk?.coaching ?? null,
  );
  const coachingRef = useRef(coaching);
  coachingRef.current = coaching;
  const requestSeqRef = useRef({ full: 0, lite: 0 });

  function applyCoaching(next: CoachingState | null) {
    coachingRef.current = next;
    setCoaching(next);
  }

  async function hydrateCoaching(opts?: CoachingFetchOptions): Promise<void> {
    const request = beginCoachingRequest(requestSeqRef.current, opts);
    const liteSeqAtStart = request.sequences.lite;
    requestSeqRef.current = request.sequences;
    const next = await fetchCoaching(opts);
    if (!request.isCurrent(requestSeqRef.current)) return;
    if (!next) return;
    if (isNextActionRefresh(opts)) {
      if (!nextActionDayMatches(coachingRef.current, next)) return hydrateCoaching();
      setCoaching((current) => mergeNextAction(current, next));
      return;
    }
    setCoaching((current) => {
      const liteWonWhileFullWasPending =
        !opts?.lite && requestSeqRef.current.lite > liteSeqAtStart;
      if (liteWonWhileFullWasPending && current) {
        return mergeCoachingState(next, current, { lite: true });
      }
      return mergeCoachingState(current, next, opts);
    });
  }

  useRehydrateOnVisible(hydrateCoaching);

  return { coaching, applyCoaching, hydrateCoaching };
}
