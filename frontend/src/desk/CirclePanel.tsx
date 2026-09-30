import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { bubbleMapLabel, circleStatLine, emptyCircleLine } from "../lib/circleLeaderboard";
import {
  CIRCLE_MIN_MEMBERS,
  circleSharePayload,
  circleShareIntentUrl,
  downloadCircleSharePng,
  fetchCircle,
  loadCircleImages,
  type CircleSharePayload,
} from "../lib/circleShare";
import { CircleBubbleMap, type BubbleMapHandle } from "./CircleBubbleMap";
import { CircleLeaderboard } from "./CircleLeaderboard";

type CircleImages = Awaited<ReturnType<typeof loadCircleImages>>;

type CircleState =
  | { phase: "loading" }
  | { phase: "empty"; people: number }
  | { phase: "error" }
  | { phase: "ready"; payload: CircleSharePayload; images: CircleImages };

const CLOSEST_SHOWN = 10;
const SHARE_HINT =
  "X cannot attach images from a link. Download the card, then add it to your post.";

export function CirclePanel({ refreshKey }: { refreshKey: string }) {
  const [state, setState] = useState<CircleState>({ phase: "loading" });
  const [expanded, setExpanded] = useState(false);
  const mapRef = useRef<BubbleMapHandle>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const linkedRowRef = useRef<Element | null>(null);

  useEffect(() => {
    let dead = false;
    void (async () => {
      const response = await fetchCircle();
      const payload = circleSharePayload(response);
      if (dead) return;
      if (!payload) {
        setState({ phase: "empty", people: response?.members.length ?? 0 });
        return;
      }
      const images = await loadCircleImages(payload);
      if (dead) return;
      setState({ phase: "ready", payload, images });
    })().catch(() => {
      if (!dead) setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
    });
    return () => {
      dead = true;
    };
  }, [refreshKey]);

  const isExpanded = expanded && state.phase === "ready";

  useEffect(() => {
    if (!isExpanded) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setExpanded(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isExpanded]);

  const linkRow = useCallback((handle: string | null) => {
    linkedRowRef.current?.classList.remove("is-linked");
    linkedRowRef.current = handle
      ? (listRef.current?.querySelector(`li[data-handle="${handle}"]`) ?? null)
      : null;
    linkedRowRef.current?.classList.add("is-linked");
  }, []);

  const hoverBubble = useCallback((handle: string | null) => {
    mapRef.current?.highlight(handle);
  }, []);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  const ready = state.phase === "ready";
  const loading = state.phase === "loading";
  const payload = ready ? state.payload : null;
  const bodyClass = [
    "desk-circle-body",
    loading ? "is-loading" : "",
    !ready && !loading ? "is-empty" : "",
    isExpanded ? "is-expanded" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <CircleFrame
      busy={loading}
      legend={ready && !isExpanded}
      stat={
        payload
          ? circleStatLine({
              people: payload.members.length,
              replies: payload.totals.replies,
              quotes: payload.totals.quotes,
            })
          : undefined
      }
    >
      <div className={bodyClass}>
        <CircleBubbleMap
          ref={mapRef}
          payload={payload}
          images={ready ? state.images : null}
          label={payload ? bubbleMapLabel(payload.members, payload.members.length) : null}
          mode={ready ? "ready" : loading ? "loading" : "ghost"}
          expanded={isExpanded}
          onToggleExpanded={toggleExpanded}
          onHover={linkRow}
        />
        {ready ? (
          <CircleLeaderboard
            members={state.payload.members.slice(0, CLOSEST_SHOWN)}
            listRef={listRef}
            onHover={hoverBubble}
          />
        ) : null}
        {ready ? (
          <div className="row desk-circle-actions">
            <a
              className="primary"
              href={circleShareIntentUrl(state.payload)}
              target="_blank"
              rel="noreferrer"
              title={SHARE_HINT}
            >
              Post on X
            </a>
            <button
              type="button"
              className="ghost"
              title={SHARE_HINT}
              onClick={() => {
                downloadCircleSharePng(state.payload, state.images).catch(() => undefined);
              }}
            >
              Download PNG
            </button>
          </div>
        ) : null}
        {loading ? (
          <>
            <div className="desk-circle-list is-skeleton" aria-hidden="true">
              {Array.from({ length: CLOSEST_SHOWN }, (_, i) => (
                <span key={i} className="desk-circle-skeleton-row" />
              ))}
            </div>
            <p className="status desk-circle-status">Drawing your circle…</p>
          </>
        ) : null}
        {state.phase === "empty" ? (
          <p className="desk-circle-empty desk-circle-message">
            {emptyCircleLine(state.people, CIRCLE_MIN_MEMBERS)}
          </p>
        ) : null}
        {state.phase === "error" ? (
          <p className="desk-circle-empty desk-circle-message">
            Could not load your circle. Refresh the desk to try again.
          </p>
        ) : null}
      </div>
    </CircleFrame>
  );
}

function CircleFrame({
  stat,
  legend = false,
  busy = false,
  children,
}: {
  stat?: string;
  legend?: boolean;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="desk-circle" aria-label="Circle" aria-busy={busy}>
      <div className="desk-circle-head">
        <h3 className="cockpit-title">X Circle</h3>
        <span className="desk-circle-count">{stat ?? ""}</span>
        {legend ? (
          <span className="desk-circle-legend" aria-hidden="true">
            <span className="desk-circle-legend-item is-replies">Replies</span>
            <span className="desk-circle-legend-item is-quotes">Quotes</span>
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
