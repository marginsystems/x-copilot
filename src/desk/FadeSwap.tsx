import { useEffect, useState } from "react";
import { FADE_SWAP_MS, fadeSwapShouldAnimate } from "../lib/fadeSwap";

export function FadeSwap({ text }: { text: string }) {
  const [shown, setShown] = useState(text);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [playIn, setPlayIn] = useState(false);

  useEffect(() => {
    if (text === shown) return;
    if (!fadeSwapShouldAnimate(shown, text)) {
      setShown(text);
      setLeaving(null);
      setPlayIn(false);
      return;
    }
    setLeaving(shown);
    setShown(text);
    setPlayIn(true);
    const timer = window.setTimeout(() => {
      setLeaving(null);
      setPlayIn(false);
    }, FADE_SWAP_MS);
    return () => window.clearTimeout(timer);
  }, [text, shown]);

  return (
    <span className="fade-swap">
      {leaving ? (
        <span className="fade-swap-item fade-swap-out" aria-hidden="true">
          {leaving}
        </span>
      ) : null}
      <span className={playIn ? "fade-swap-item fade-swap-in" : "fade-swap-item"}>
        {shown}
      </span>
    </span>
  );
}
