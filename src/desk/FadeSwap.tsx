import { useEffect, useRef, useState } from "react";
import { FADE_SWAP_MS, fadeSwapShouldAnimate } from "../lib/fadeSwap";

export function FadeSwap({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [playIn, setPlayIn] = useState(false);
  const shownRef = useRef(text);

  useEffect(() => {
    const prev = shownRef.current;
    if (prev === text) return;
    shownRef.current = text;
    if (!fadeSwapShouldAnimate(prev, text)) {
      setShown(text);
      setLeaving(null);
      setPlayIn(false);
      return;
    }
    setLeaving(prev);
    setShown(text);
    setPlayIn(true);
    const timer = window.setTimeout(() => {
      setLeaving(null);
      setPlayIn(false);
    }, FADE_SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [text]);

  return (
    <span className="fade-swap">
      {leaving ? (
        <span className="fade-swap-item fade-swap-out" aria-hidden="true" key={leaving}>
          {leaving}
        </span>
      ) : null}
      <span className={playIn ? "fade-swap-item fade-swap-in" : "fade-swap-item"} key={shown}>
        {shown}
      </span>
    </span>
  );
}
