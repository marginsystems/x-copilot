import { useEffect, useState, type ReactNode } from "react";
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

type CircleImages = Awaited<ReturnType<typeof loadCircleImages>>;

type CircleState =
  | { phase: "loading" }
  | { phase: "empty" }
  | { phase: "error" }
  | { phase: "ready"; payload: CircleSharePayload; images: CircleImages; src: string };

const CLOSEST_SHOWN = 8;

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function CirclePanel({ refreshKey }: { refreshKey: string }) {
  const [state, setState] = useState<CircleState>({ phase: "loading" });

  useEffect(() => {
    let dead = false;
    let url: string | null = null;
    void (async () => {
      const payload = circleSharePayload(await fetchCircle());
      if (dead) return;
      if (!payload) {
        setState({ phase: "empty" });
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
          <span className="desk-circle-preview is-skeleton" aria-hidden="true" />
          <div className="desk-circle-side">
            <p className="status desk-circle-status">Drawing your circle…</p>
            <div className="desk-circle-skeleton" aria-hidden="true">
              {Array.from({ length: CLOSEST_SHOWN }, (_, i) => (
                <span key={i} className="desk-circle-skeleton-row" />
              ))}
            </div>
          </div>
        </div>
      </CircleFrame>
    );
  }

  if (state.phase === "empty") {
    return (
      <CircleFrame>
        <p className="desk-circle-empty desk-circle-message">
          Your circle fills in as you reply and quote on X. It shows up once
          you have talked with at least {CIRCLE_MIN_MEMBERS} people.
        </p>
      </CircleFrame>
    );
  }

  if (state.phase === "error") {
    return (
      <CircleFrame>
        <p className="desk-circle-empty desk-circle-message">
          Could not load your circle. Refresh the desk to try again.
        </p>
      </CircleFrame>
    );
  }

  const { payload, images, src } = state;
  const closest = payload.members.slice(0, CLOSEST_SHOWN);

  return (
    <CircleFrame count={plural(payload.members.length, "person", "people")}>
      <div className="desk-circle-body">
        <img
          className="desk-circle-preview"
          width={CIRCLE_SHARE_WIDTH}
          height={CIRCLE_SHARE_HEIGHT}
          src={src}
          alt={`X Circle card with ${payload.members.length} people`}
        />
        <div className="desk-circle-side">
          <ol className="desk-circle-list" aria-label="Closest">
            {closest.map((m, i) => (
              <li key={m.handle}>
                <span className="desk-circle-rank" aria-hidden="true">
                  {i + 1}
                </span>
                <a
                  href={`https://x.com/${m.handle}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  @{m.handle}
                </a>
                <span className="desk-circle-score">
                  {plural(m.replies, "reply", "replies")}
                  {m.quotes > 0
                    ? ` · ${plural(m.quotes, "quote", "quotes")}`
                    : ""}
                </span>
              </li>
            ))}
          </ol>
          <div className="row desk-circle-actions">
            <a
              className="primary"
              href={circleShareIntentUrl(payload)}
              target="_blank"
              rel="noreferrer"
            >
              Post on X
            </a>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                downloadCircleSharePng(payload, images).catch(() => undefined);
              }}
            >
              Download PNG
            </button>
          </div>
          <p className="desk-circle-note">
            X cannot attach images from a link. Download the card, then add it
            to your post.
          </p>
        </div>
      </div>
    </CircleFrame>
  );
}

function CircleFrame({
  count,
  busy = false,
  children,
}: {
  count?: string;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="desk-circle" aria-label="Circle" aria-busy={busy}>
      <div className="desk-circle-head">
        <h3 className="cockpit-title">Circle</h3>
        <span className="desk-circle-count">{count ?? ""}</span>
      </div>
      {children}
    </section>
  );
}
