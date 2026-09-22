import { useEffect, useRef, useState } from "react";
import { useSession } from "../auth/session";
import {
  emptyActivityStats,
  fetchActivityStats,
  type ActivityBucket,
  type ActivityStats,
} from "../lib/activityStats";
import type { DeskBootDeskPatch } from "../lib/deskBoot";
import { peekDeskBootCache } from "../lib/deskBoot";
import { readDeskTopOpen, writeDeskTopOpen } from "../lib/deskLayout";
import {
  emptyGamificationStats,
  fetchGamification,
  type GamificationStats,
} from "../lib/gamification";

type ActivityStripCommit =
  | { kind: "activityStats"; value: ActivityStats }
  | { kind: "gamification"; value: GamificationStats };

export function useActivityStrip(
  verifiedOwnerId: string | null,
  onCommit?: (commit: ActivityStripCommit) => void,
) {
  const session = useSession();
  const seed = peekDeskBootCache(verifiedOwnerId)?.desk ?? null;
  const seedBucket = seed?.activityStats.bucket ?? "day";
  const [activityBucket, setActivityBucket] = useState<ActivityBucket>(
    seedBucket,
  );
  const [flightPathOpen, setFlightPathOpen] = useState(() =>
    readSessionFlag("x-copilot-flight-path-open", 700),
  );
  const [deskTopOpen, setDeskTopOpen] = useState(() => readDeskTopOpen());
  const [activityStats, setActivityStats] = useState<ActivityStats>(
    () => seed?.activityStats ?? emptyActivityStats("day"),
  );
  const [gamification, setGamification] = useState<GamificationStats>(
    () => seed?.gamification ?? emptyGamificationStats(),
  );
  const activityBucketRef = useRef<ActivityBucket>(seedBucket);
  /** In-flight toggle target; may diverge from applied `activityBucketRef`. */
  const activityRequestBucketRef = useRef<ActivityBucket>(seedBucket);
  /** Set once a user toggles the bucket; boot's snapshot bucket is then stale. */
  const stripStaleRef = useRef(false);
  /** Monotonic token so out-of-order gamification responses don't regress the chip. */
  const gamificationRequestSeqRef = useRef(0);

  const activityRequestSeqRef = useRef(0);
  const lifetime = useRef(0);
  useEffect(() => () => {
    lifetime.current++;
    activityRequestSeqRef.current++;
  }, []);

  async function hydrateActivityStats(
    bucket: ActivityBucket = activityRequestBucketRef.current,
  ) {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    const seq = ++activityRequestSeqRef.current;
    const next = await fetchActivityStats(bucket);
    if (!session.isCurrent(generation) || seq !== activityRequestSeqRef.current) return;
    if (!next) return;
    // Ignore stale responses if a newer toggle request is in flight.
    if (bucket !== activityRequestBucketRef.current) return;
    // A successful refresh started after boot began must win over boot's older snapshot.
    stripStaleRef.current = true;
    // Commit the applied bucket only after a successful fetch so a failed
    // toggle cannot silently flip the chart on a later mark refresh.
    activityBucketRef.current = bucket;
    setActivityBucket(bucket);
    setActivityStats(next);
    onCommit?.({ kind: "activityStats", value: next });
  }

  function applyStripFromBoot(desk: DeskBootDeskPatch) {
    if (desk.gamification && gamificationRequestSeqRef.current === 0) {
      setGamification(desk.gamification);
    }
    if (!desk.activityStats || stripStaleRef.current) return;
    setActivityStats(desk.activityStats);
    activityBucketRef.current = desk.activityStats.bucket;
    activityRequestBucketRef.current = desk.activityStats.bucket;
    setActivityBucket(desk.activityStats.bucket);
  }

  async function hydrateGamification() {
    const generation = session.capture();
    if (!session.isCurrent(generation)) return;
    const mounted = lifetime.current;
    const seq = ++gamificationRequestSeqRef.current;
    const next = await fetchGamification();
    if (!session.isCurrent(generation) || seq !== gamificationRequestSeqRef.current) return;
    if (mounted !== lifetime.current) return;
    if (!next) return;
    setGamification(next);
    onCommit?.({ kind: "gamification", value: next });
  }

  function onActivityBucket(next: ActivityBucket) {
    activityRequestBucketRef.current = next;
    stripStaleRef.current = true;
    hydrateActivityStats(next).catch((err: unknown) => console.error(err));
  }

  function onToggleFlightPath() {
    setFlightPathOpen((prev) => writeSessionFlag("x-copilot-flight-path-open", !prev));
  }

  function onToggleDeskTop() {
    setDeskTopOpen((prev) => writeDeskTopOpen(!prev));
  }

  return {
    activityBucket,
    flightPathOpen,
    deskTopOpen,
    activityStats,
    gamification,
    applyStripFromBoot,
    hydrateActivityStats,
    hydrateGamification,
    onActivityBucket,
    onToggleFlightPath,
    onToggleDeskTop,
  };
}

function readSessionFlag(key: string, openFromPx: number): boolean {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored === "0") return false;
    if (stored === "1") return true;
  } catch {
    /* private mode */
  }
  return (
    typeof window !== "undefined" &&
    window.matchMedia(`(min-width: ${openFromPx}px)`).matches
  );
}

function writeSessionFlag(key: string, next: boolean): boolean {
  try {
    sessionStorage.setItem(key, next ? "1" : "0");
  } catch {
    /* private mode */
  }
  return next;
}
