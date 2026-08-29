import { useEffect, useRef, useState } from "react";
import { FADE_SWAP_MS, fadeSwapShouldAnimate } from "../lib/fadeSwap";

export function FadeSwap({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [playIn, setPlayIn] = useState(false);
  const shownRef = useRef(text);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const prev = shownRef.current;
    if (prev === text) return;
    shownRef.current = text;
    setShown(text);
    if (!fadeSwapShouldAnimate(prev, text)) return;
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
    }
    setLeaving(prev);
    setPlayIn(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setLeaving(null);
      setPlayIn(false);
    }, FADE_SWAP_MS);
  }, [text]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    },
    [],
  );

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
