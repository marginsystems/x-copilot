import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DeskRowAction = { key: string; node: ReactNode };

export const ACTION_SLIDE_MS = 280;
const ACTION_FADE_MS = 140;
const EASE_OUT = "cubic-bezier(0.22, 1, 0.36, 1)";

type Spot = { left: number; top: number };
type Departing = { key: string; node: ReactNode; spot: Spot };
type Snapshot = {
  spots: Map<string, Spot>;
  nodes: Map<string, ReactNode>;
  height: number;
};

function canAnimate() {
  return (
    typeof window !== "undefined" &&
    typeof Element !== "undefined" &&
    typeof Element.prototype.animate === "function" &&
    typeof window.matchMedia === "function" &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function DepartingAction({
  departing,
  onDone,
}: {
  departing: Departing;
  onDone: (key: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const { key } = departing;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof el.animate !== "function") {
      onDone(key);
      return;
    }
    const fade = el.animate(
      [
        { opacity: 1, easing: "ease-out" },
        { opacity: 0, offset: ACTION_FADE_MS / ACTION_SLIDE_MS },
        { opacity: 0 },
      ],
      { duration: ACTION_SLIDE_MS, fill: "forwards" },
    );
    fade.onfinish = () => onDone(key);
    return () => {
      fade.onfinish = null;
      fade.cancel();
    };
  }, [key, onDone]);

  return (
    <span
      ref={ref}
      className="row-action is-leaving"
      data-action={key}
      style={{ left: departing.spot.left, top: departing.spot.top }}
      aria-hidden="true"
      {...{ inert: "" }}
    >
      {departing.node}
    </span>
  );
}

export function DeskRowActions({ actions }: { actions: DeskRowAction[] }) {
  const shown = actions.filter((action) => action.node != null);
  const shownKey = shown.map((action) => action.key).join(" ");
  const rowRef = useRef<HTMLDivElement>(null);
  const units = useRef(new Map<string, HTMLSpanElement>());
  const snapshot = useRef<Snapshot | null>(null);
  const draining = useRef(false);
  const [departing, setDeparting] = useState<Departing[]>([]);
  const [seenKey, setSeenKey] = useState(shownKey);

  if (seenKey !== shownKey) {
    setSeenKey(shownKey);
    const stay = new Set(shown.map((action) => action.key));
    const leaving: Departing[] = [];
    const prev = snapshot.current;
    if (prev && canAnimate()) {
      for (const [key, spot] of prev.spots) {
        if (stay.has(key)) continue;
        if (departing.some((item) => item.key === key)) continue;
        leaving.push({ key, spot, node: prev.nodes.get(key) });
      }
    }
    setDeparting((current) => [
      ...current.filter((item) => !stay.has(item.key)),
      ...leaving,
    ]);
  }

  const ghosts = departing.filter(
    (item) => !shown.some((action) => action.key === item.key),
  );
  const empty = shown.length === 0;

  const finish = useCallback((key: string) => {
    setDeparting((current) => current.filter((item) => item.key !== key));
  }, []);

  useLayoutEffect(() => {
    const row = rowRef.current;
    const prev = snapshot.current;
    if (!row) {
      snapshot.current = null;
      draining.current = false;
      return;
    }

    const spots = new Map<string, Spot>();
    for (const action of shown) {
      const el = units.current.get(action.key);
      if (el) spots.set(action.key, { left: el.offsetLeft, top: el.offsetTop });
    }
    const nodes = new Map(shown.map((action) => [action.key, action.node]));
    const height = row.offsetHeight;
    snapshot.current = { spots, nodes, height };

    if (!prev || !canAnimate()) return;

    for (const [key, spot] of spots) {
      const was = prev.spots.get(key);
      const el = units.current.get(key);
      if (!was || !el) continue;
      const dx = was.left - spot.left;
      const dy = was.top - spot.top;
      if (dx === 0 && dy === 0) continue;
      el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0, 0)" },
        ],
        { duration: ACTION_SLIDE_MS, easing: EASE_OUT },
      );
    }

    if (empty && ghosts.length > 0) {
      if (!draining.current) {
        draining.current = true;
        row.animate(
          [
            { height: `${prev.height}px` },
            { height: "0px", paddingBottom: "0px" },
          ],
          { duration: ACTION_SLIDE_MS, easing: EASE_OUT, fill: "forwards" },
        );
      }
      return;
    }

    if (draining.current) {
      draining.current = false;
      for (const animation of row.getAnimations()) animation.cancel();
      snapshot.current.height = row.offsetHeight;
      return;
    }

    if (Math.abs(prev.height - height) > 0.5) {
      row.animate(
        [{ height: `${prev.height}px` }, { height: `${height}px` }],
        { duration: ACTION_SLIDE_MS, easing: EASE_OUT },
      );
    }
  });

  if (empty && ghosts.length === 0) return null;

  return (
    <div
      ref={rowRef}
      className={empty ? "row is-draining" : "row"}
      onClick={(event) => event.stopPropagation()}
    >
      {ghosts.map((item) => (
        <DepartingAction key={`gone-${item.key}`} departing={item} onDone={finish} />
      ))}
      {shown.map((action) => (
        <span
          key={action.key}
          ref={(el) => {
            if (el) units.current.set(action.key, el);
            else units.current.delete(action.key);
          }}
          className="row-action"
          data-action={action.key}
        >
          {action.node}
        </span>
      ))}
    </div>
  );
}
