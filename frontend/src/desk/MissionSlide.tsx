import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MISSION_SLIDE_MS } from "../lib/missionSlide";

type Slide = { key: string; node: ReactNode };

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function MissionSlide({
  slideKey,
  children,
}: {
  slideKey: string;
  children: ReactNode;
}) {
  const committed = useRef<Slide>({ key: slideKey, node: children });
  const inertCard = useRef<HTMLDivElement | null>(null);
  const [shownKey, setShownKey] = useState(slideKey);
  const [leaving, setLeaving] = useState<Slide | null>(null);

  if (shownKey !== slideKey) {
    setShownKey(slideKey);
    setLeaving(prefersReducedMotion() ? null : committed.current);
  }

  useLayoutEffect(() => {
    committed.current = { key: slideKey, node: children };
  });

  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(null), MISSION_SLIDE_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  return (
    <div className="mission-slide">
      {leaving && leaving.key !== slideKey ? (
        <div
          key={leaving.key}
          className="mission-slide-card is-leaving"
          aria-hidden="true"
          ref={(element) => {
            if (element) {
              element.setAttribute("inert", "");
              inertCard.current = element;
            } else {
              inertCard.current?.removeAttribute("inert");
              inertCard.current = null;
            }
          }}
        >
          {leaving.node}
        </div>
      ) : null}
      <div key={slideKey} className="mission-slide-card">
        {children}
      </div>
    </div>
  );
}
