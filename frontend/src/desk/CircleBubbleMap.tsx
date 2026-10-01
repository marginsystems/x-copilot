import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { CircleSharePayload } from "../lib/circleShare";
import { createBubbleMap, type BubbleImages, type BubbleMapEngine } from "./bubbleMapEngine";

export type BubbleMapHandle = {
  highlight: (handle: string | null) => void;
};

type Props = {
  payload: CircleSharePayload | null;
  images: BubbleImages | null;
  label: string | null;
  mode: "ready" | "loading" | "ghost";
  expanded: boolean;
  onToggleExpanded: () => void;
  onHover: (handle: string | null) => void;
};

export const CircleBubbleMap = forwardRef<BubbleMapHandle, Props>(function CircleBubbleMap(
  { payload, images, label, mode, expanded, onToggleExpanded, onHover },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<BubbleMapEngine | null>(null);
  const hoverRef = useRef(onHover);

  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return undefined;
    const engine = createBubbleMap(canvas, host, {
      onHover: (handle) => hoverRef.current(handle),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    engineRef.current?.setExpanded(expanded);
  }, [expanded]);

  useEffect(() => {
    engineRef.current?.setData(payload, images);
  }, [payload, images]);

  useImperativeHandle(
    ref,
    () => ({ highlight: (handle) => engineRef.current?.setHighlight(handle) }),
    [],
  );

  const actionLabel = expanded ? "Collapse the circle map" : "Expand the circle map";

  return (
    <div
      ref={hostRef}
      className={`desk-circle-map${mode === "loading" ? " is-skeleton" : ""}${mode === "ghost" ? " is-ghost" : ""}`}
    >
      <canvas
        ref={canvasRef}
        className="desk-circle-canvas"
        role={label ? "img" : undefined}
        aria-label={label ?? undefined}
        aria-hidden={label ? undefined : true}
      />
      {mode === "ready" ? (
        <button
          type="button"
          className="desk-circle-expand"
          aria-label={actionLabel}
          aria-pressed={expanded}
          title={expanded ? "Collapse (Esc)" : "Expand"}
          onClick={onToggleExpanded}
        >
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            {expanded ? (
              <path d="M6 2v4H2M10 2v4h4M6 14v-4H2M10 14v-4h4" />
            ) : (
              <path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" />
            )}
          </svg>
        </button>
      ) : null}
    </div>
  );
});
