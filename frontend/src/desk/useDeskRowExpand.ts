import { useEffect, useState } from "react";
import {
  DESK_ROW_EXPAND_MS,
  deskRowKeepMount,
  deskRowExpandOpen,
  deskRowInitialPhase,
  deskRowPhaseAfterEnter,
  deskRowPhaseAfterLeave,
  deskRowPhaseOnOpenChange,
  type DeskRowExpandPhase,
} from "../lib/deskRow";

export function useDeskRowExpand(open: boolean): {
  mount: boolean;
  expanded: boolean;
} {
  const [phase, setPhase] = useState<DeskRowExpandPhase>(() =>
    deskRowInitialPhase(open),
  );
  const [everOpened, setEverOpened] = useState(open);
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
    if (open) setEverOpened(true);
    setPhase((current) => deskRowPhaseOnOpenChange(current, open));
  }

  useEffect(() => {
    if (phase === "entering") {
      let cancelled = false;
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) setPhase(deskRowPhaseAfterEnter);
        });
      });
      return () => {
        cancelled = true;
        cancelAnimationFrame(id);
      };
    }
    if (phase === "leaving") {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setPhase(deskRowPhaseAfterLeave);
      } else {
        const timer = setTimeout(
          () => setPhase(deskRowPhaseAfterLeave),
          DESK_ROW_EXPAND_MS,
        );
        return () => clearTimeout(timer);
      }
    }
    return undefined;
  }, [phase]);

  return {
    mount: deskRowKeepMount(phase, everOpened),
    expanded: deskRowExpandOpen(phase),
  };
}
