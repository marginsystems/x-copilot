import { useCallback, useRef, useState } from "react";
import { DESK_ROW_EXPAND_MS } from "../lib/deskRow";

export function useDeskRowExit(): {
  exitingIds: Set<string>;
  beginExit: (id: string, then: () => void | Promise<void>) => void;
  clearGone: (liveIds: Iterable<string>) => void;
} {
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Set<string>());

  const beginExit = useCallback(
    (id: string, then: () => void | Promise<void>) => {
      if (pending.current.has(id)) return;
      pending.current.add(id);
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      const revert = () => {
        pending.current.delete(id);
        setExitingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      };
      const fire = () => {
        const result = then();
        if (result && typeof (result as Promise<void>).then === "function") {
          void Promise.resolve(result).then(revert, revert);
        } else {
          revert();
        }
      };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        fire();
      } else {
        window.setTimeout(fire, DESK_ROW_EXPAND_MS);
      }
    },
    [],
  );

  const clearGone = useCallback((liveIds: Iterable<string>) => {
    const live = new Set(liveIds);
    setExitingIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (live.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, []);

  return { exitingIds, beginExit, clearGone };
}
