import { useCallback, useRef, useState } from "react";
import { DESK_ROW_EXPAND_MS } from "../lib/deskRow";

export function useDeskRowExit(): {
  exitingIds: Set<string>;
  beginExit: (id: string, then: () => void) => void;
} {
  const [exitingIds, setExitingIds] = useState<Set<string>>(() => new Set());
  const pending = useRef(new Set<string>());

  const beginExit = useCallback((id: string, then: () => void) => {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setExitingIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    window.setTimeout(() => {
      then();
      pending.current.delete(id);
      setExitingIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, DESK_ROW_EXPAND_MS);
  }, []);

  return { exitingIds, beginExit };
}
