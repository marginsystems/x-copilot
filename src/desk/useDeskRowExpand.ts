import { useEffect, useState } from "react";
import {
  DESK_ROW_EXPAND_MS,
  deskRowExpandMount,
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
  const [seenOpen, setSeenOpen] = useState(open);
  if (open !== seenOpen) {
    setSeenOpen(open);
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
      const timer = setTimeout(
        () => setPhase(deskRowPhaseAfterLeave),
        DESK_ROW_EXPAND_MS,
      );
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [phase]);

  return {
    mount: deskRowExpandMount(phase),
    expanded: deskRowExpandOpen(phase),
  };
}
