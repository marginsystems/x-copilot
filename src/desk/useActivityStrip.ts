import { useRef, useState } from "react";
import {
  emptyActivityStats,
  fetchActivityStats,
  type ActivityBucket,
  type ActivityStats,
} from "../lib/activityStats";
import {
  emptyGamificationStats,
  fetchGamification,
  type GamificationStats,
} from "../lib/gamification";

export function useActivityStrip() {
  const [activityBucket, setActivityBucket] = useState<ActivityBucket>("day");
  const [flightPathOpen, setFlightPathOpen] = useState(() => {
    try {
      const stored = sessionStorage.getItem("x-copilot-flight-path-open");
      if (stored === "0") return false;
      if (stored === "1") return true;
    } catch {
      /* private mode */
    }
    return (
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 700px)").matches
    );
  });
  const [activityStats, setActivityStats] = useState<ActivityStats>(() =>
    emptyActivityStats("day"),
  );
  const [gamification, setGamification] = useState<GamificationStats>(() =>
    emptyGamificationStats(),
  );
  const activityBucketRef = useRef<ActivityBucket>("day");
  /** In-flight toggle target; may diverge from applied `activityBucketRef`. */
  const activityRequestBucketRef = useRef<ActivityBucket>("day");
  /** Monotonic token so out-of-order gamification responses don't regress the chip. */
  const gamificationRequestSeqRef = useRef(0);

  async function hydrateActivityStats(
    bucket: ActivityBucket = activityBucketRef.current,
  ) {
    const next = await fetchActivityStats(bucket);
    if (!next) return;
    // Ignore stale responses if a newer toggle request is in flight.
    if (bucket !== activityRequestBucketRef.current) return;
    // Commit the applied bucket only after a successful fetch so a failed
    // toggle cannot silently flip the chart on a later mark refresh.
    activityBucketRef.current = bucket;
    setActivityBucket(bucket);
    setActivityStats(next);
  }

  async function hydrateGamification() {
    const seq = ++gamificationRequestSeqRef.current;
    const next = await fetchGamification();
    if (seq !== gamificationRequestSeqRef.current) return;
    if (!next) return;
    setGamification(next);
  }

  function onActivityBucket(next: ActivityBucket) {
    activityRequestBucketRef.current = next;
    void hydrateActivityStats(next);
  }

  function onToggleFlightPath() {
    setFlightPathOpen((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem("x-copilot-flight-path-open", next ? "1" : "0");
      } catch {
        /* private mode */
      }
      return next;
    });
  }

  return {
    activityBucket,
    flightPathOpen,
    activityStats,
    gamification,
    hydrateActivityStats,
    hydrateGamification,
    onActivityBucket,
    onToggleFlightPath,
  };
}
