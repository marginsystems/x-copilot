import { useCallback, useEffect, useRef, useState } from "react";
import { DESK_ROW_EXPAND_MS } from "../lib/deskRow";

export function useDeskRowExit(): {
  exitingIds: Set<string>;
  beginExit: (id: string, then: () => void | Promise<void>) => void;
  clearGone: (liveIds: Iterable<string>) => void;
} {
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Set<string>());
  const timers = useRef(new Map<string, number>());
  const disposed = useRef(false);

  useEffect(() => {
    disposed.current = false;
    return () => {
      // Leaving the desk must not run a skip/dismiss/complete that the user
      // can no longer see. Actions already in flight are left to settle.
      disposed.current = true;
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
      pending.current.clear();
    };
  }, []);

  const beginExit = useCallback(
    (id: string, then: () => void | Promise<void>) => {
      if (disposed.current || pending.current.has(id)) return;
      pending.current.add(id);
      setExitingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
      const revert = () => {
        pending.current.delete(id);
        if (disposed.current) return;
        setExitingIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      };
      const fire = () => {
        timers.current.delete(id);
        let result: void | Promise<void>;
        try {
          result = then();
        } catch (err) {
          // A synchronous failure must not leave the row stuck mid-exit.
          revert();
          throw err;
        }
        if (result && typeof (result as Promise<void>).then === "function") {
          void Promise.resolve(result).then(revert, revert);
        } else {
          revert();
        }
      };
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        fire();
      } else {
        timers.current.set(id, window.setTimeout(fire, DESK_ROW_EXPAND_MS));
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
