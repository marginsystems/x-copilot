import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type LearnTipProps = {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
};

export function LearnTip(props: LearnTipProps) {
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (open) panel.removeAttribute("inert");
    else panel.setAttribute("inert", "");
  }, [open]);
  return (
    <div className={open ? "learn-tip is-open" : "learn-tip"}>
      <button
        type="button"
        className="learn-tip-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((next) => !next)}
      >
        <span>Tip</span>
        {props.title}
      </button>
      <div
        className="learn-tip-panel"
        id={panelId}
        ref={panelRef}
        aria-hidden={!open}
      >
        <div className="learn-tip-inner">{props.children}</div>
      </div>
    </div>
  );
}
