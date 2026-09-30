import { useEffect, useState, type ReactNode } from "react";
import { circleStatLine, emptyCircleLine, ghostRing } from "../lib/circleLeaderboard";
import {
  CIRCLE_MIN_MEMBERS,
  CIRCLE_SHARE_HEIGHT,
  CIRCLE_SHARE_WIDTH,
  circleSharePayload,
  circleShareIntentUrl,
  downloadCircleSharePng,
  fetchCircle,
  loadCircleImages,
  renderCircleShareBlob,
  type CircleSharePayload,
} from "../lib/circleShare";
import { CircleCardModal } from "./CircleCardModal";
import { CircleLeaderboard } from "./CircleLeaderboard";

type CircleImages = Awaited<ReturnType<typeof loadCircleImages>>;

type CircleState =
  | { phase: "loading" }
  | { phase: "empty"; people: number }
  | { phase: "error" }
  | { phase: "ready"; payload: CircleSharePayload; images: CircleImages; src: string };

const CLOSEST_SHOWN = 10;

export function CirclePanel({ refreshKey }: { refreshKey: string }) {
  const [state, setState] = useState<CircleState>({ phase: "loading" });
  const [cardOpen, setCardOpen] = useState(false);

  useEffect(() => {
    let dead = false;
    let url: string | null = null;
    void (async () => {
      const response = await fetchCircle();
      const payload = circleSharePayload(response);
      if (dead) return;
      if (!payload) {
        setState({ phase: "empty", people: response?.members.length ?? 0 });
        return;
      }
      const images = await loadCircleImages(payload);
      const blob = await renderCircleShareBlob(payload, images);
      if (dead) return;
      url = URL.createObjectURL(blob);
      setState({ phase: "ready", payload, images, src: url });
    })().catch(() => {
      if (!dead) setState((prev) => (prev.phase === "ready" ? prev : { phase: "error" }));
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [refreshKey]);

  if (state.phase === "loading") {
    return (
      <CircleFrame busy>
        <div className="desk-circle-body is-loading">
          <span className="desk-circle-thumb is-skeleton" aria-hidden="true" />
          <div className="desk-circle-list is-skeleton" aria-hidden="true">
            {Array.from({ length: CLOSEST_SHOWN }, (_, i) => (
              <span key={i} className="desk-circle-skeleton-row" />
            ))}
          </div>
          <p className="status desk-circle-status">Drawing your circle…</p>
        </div>
      </CircleFrame>
    );
  }

  if (state.phase === "empty") {
    return (
      <CircleFrame>
        <div className="desk-circle-body is-empty">
          <GhostRing />
          <p className="desk-circle-empty desk-circle-message">
            {emptyCircleLine(state.people, CIRCLE_MIN_MEMBERS)}
          </p>
        </div>
      </CircleFrame>
    );
  }

  if (state.phase === "error") {
    return (
      <CircleFrame>
        <div className="desk-circle-body is-empty">
          <GhostRing />
          <p className="desk-circle-empty desk-circle-message">
            Could not load your circle. Refresh the desk to try again.
          </p>
        </div>
      </CircleFrame>
    );
  }

  const { payload, images, src } = state;
  const closest = payload.members.slice(0, CLOSEST_SHOWN);

  return (
    <CircleFrame
      stat={circleStatLine({
        people: payload.members.length,
        replies: payload.totals.replies,
        quotes: payload.totals.quotes,
      })}
      legend
    >
      <div className="desk-circle-body">
        <button
          type="button"
          className="desk-circle-thumb"
          aria-label="Open the X Circle card at full size"
          aria-haspopup="dialog"
          onClick={() => setCardOpen(true)}
        >
          <img
            width={CIRCLE_SHARE_WIDTH}
            height={CIRCLE_SHARE_HEIGHT}
            src={src}
            alt={`X Circle card with ${payload.members.length} people`}
          />
        </button>
        <CircleLeaderboard members={closest} />
        <div className="row desk-circle-actions">
          <a
            className="primary"
            href={circleShareIntentUrl(payload)}
            target="_blank"
            rel="noreferrer"
            title="X cannot attach images from a link. Download the card, then add it to your post."
          >
            Post on X
          </a>
          <button
            type="button"
            className="ghost"
            title="X cannot attach images from a link. Download the card, then add it to your post."
            onClick={() => {
              downloadCircleSharePng(payload, images).catch(() => undefined);
            }}
          >
            Download PNG
          </button>
        </div>
      </div>
      {cardOpen ? (
        <CircleCardModal
          payload={payload}
          images={images}
          src={src}
          onClose={() => setCardOpen(false)}
        />
      ) : null}
    </CircleFrame>
  );
}

function GhostRing() {
  return (
    <svg
      className="desk-circle-thumb is-ghost"
      viewBox="0 0 100 125"
      aria-hidden="true"
    >
      {ghostRing().map((disc) => (
        <circle key={`${disc.x}-${disc.y}`} cx={disc.x} cy={disc.y} r={disc.r} />
      ))}
    </svg>
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
