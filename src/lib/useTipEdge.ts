import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { estimateTipWidth, tipAlignClass, tipEdge, type TipEdge } from "./tipEdge";

export function useTipEdge<T extends HTMLElement>(): {
  ref: RefObject<T>;
  alignClass: string;
  place: () => void;
} {
  const ref = useRef<T>(null);
  const [edge, setEdge] = useState<TipEdge>("center");

  function place() {
    const el = ref.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    setEdge(
      tipEdge(
        box.left + box.width / 2,
        estimateTipWidth(window.innerWidth),
        window.innerWidth,
        12,
        box.width / 2,
      ),
    );
  }

  useLayoutEffect(() => {
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, []);

  return { ref, alignClass: tipAlignClass(edge), place };
}
