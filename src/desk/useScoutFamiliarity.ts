import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useSession } from "../auth/session";
import {
  peekDeskBootCache,
  writeDeskBootCache,
  type DeskBootDeskPatch,
} from "../lib/deskBoot";
import {
  fetchScoutFamiliarity,
  type ScoutFamiliarity,
} from "../lib/scoutFamiliarity";

/** Displayed projection plus the verified owner it belongs to (private). */
type OwnedFamiliarity = { owner: string; value: ScoutFamiliarity };

/**
 * Owns the desk's nullable Scout familiarity: seed from the verified owner's
 * boot cache, apply the boot slice, and refresh through `GET /api/scout/profile`
 * on the existing history/action seams. Separate from gamification: nothing
 * here touches XP, and no familiarity field reaches GamificationStats.
 *
 * Every commit checks session generation, verified owner, mounted lifetime
 * and request order. Revision comparisons are owner scoped. An unavailable
 * refresh clears the display (and the owned cache slice) rather than
 * showing stale or fabricated data; the next existing refresh may recover.
 */
export function useScoutFamiliarity(verifiedOwnerId: string | null) {
  const session = useSession();
  // Subscribe here so a verify() that lands after the first paint re-renders
  // this hook. Callers often read the owner once per render and would otherwise
  // stay on the unverified null from the first frame.
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [state, setState] = useState<OwnedFamiliarity | null>(() => {
    const seed = peekDeskBootCache(verifiedOwnerId)?.desk?.scoutFamiliarity;
    return verifiedOwnerId && seed ? { owner: verifiedOwnerId, value: seed } : null;
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const requestSeqRef = useRef(0);
  /** Bumped on every commit so a refresh can tell whether newer data landed. */
  const commitSerialRef = useRef(0);
  const lifetime = useRef(0);
  useEffect(() => () => {
    lifetime.current++;
    requestSeqRef.current++;
  }, []);

  // The first render often has no verified owner yet. Seed once that owner
  // is known, and drop the previous owner's slice on a switch or sign-out.
  useEffect(() => {
    if (!verifiedOwnerId) {
      stateRef.current = null;
      setState(null);
      return;
    }
    setState((current) => {
      if (current?.owner === verifiedOwnerId) return current;
      const seed = peekDeskBootCache(verifiedOwnerId)?.desk?.scoutFamiliarity ?? null;
      const next = seed ? { owner: verifiedOwnerId, value: seed } : null;
      stateRef.current = next;
      return next;
    });
  }, [verifiedOwnerId]);

  function verifiedOwner(): string | null {
    return session.getSnapshot().user?.id ?? null;
  }

  /** Update the cached boot envelope only when it is owned by `owner`. */
  function cacheSlice(owner: string, value: ScoutFamiliarity | null) {
    const cached = peekDeskBootCache(owner);
    if (!cached?.desk || cached.user?.id !== owner) return;
    if (cached.desk.scoutFamiliarity === value) return;
    writeDeskBootCache({
      ...cached,
      desk: { ...cached.desk, scoutFamiliarity: value },
    });
  }

  function commit(owner: string, next: ScoutFamiliarity | null) {
    const current = stateRef.current;
    if (next && current && current.owner === owner && current.value.revision > next.revision) {
      return; // older data for the same owner never regresses a newer revision
    }
    commitSerialRef.current++;
    const value = next ? { owner, value: next } : null;
    stateRef.current = value;
    setState(value);
    cacheSlice(owner, next);
  }

  function applyScoutFamiliarityFromBoot(desk: DeskBootDeskPatch) {
    if (desk.scoutFamiliarity === undefined) return; // older payload: no claim
    const owner = verifiedOwner();
    if (!owner) return;
    commit(owner, desk.scoutFamiliarity);
  }

  async function hydrateScoutFamiliarity() {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    const owner = verifiedOwner();
    if (!owner) return;
    const mounted = lifetime.current;
    const seq = ++requestSeqRef.current;
    const serial = commitSerialRef.current;
    const next = await fetchScoutFamiliarity();
    if (!session.isCurrent(generation) || mounted !== lifetime.current) return;
    if (seq !== requestSeqRef.current) return;
    if (verifiedOwner() !== owner) return;
    // A failure only clears what this request was refreshing; data committed
    // while it was in flight is newer and stays.
    if (!next && commitSerialRef.current !== serial) return;
    commit(owner, next);
  }

  return {
    scoutFamiliarity:
      state && verifiedOwnerId && state.owner === verifiedOwnerId ? state.value : null,
    applyScoutFamiliarityFromBoot,
    hydrateScoutFamiliarity,
  };
}
