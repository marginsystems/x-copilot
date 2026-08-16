import { useEffect, useState } from "react";
import { apiFetch } from "./lib/apiBase";

type OwnPostKind = "original" | "reply" | "quote" | "repost";

type AnalyticsPost = {
  id: string;
  kind: OwnPostKind;
  text: string | null;
  postedAt: string;
  url: string | null;
  views: number;
  likes: number;
  replies: number;
  retweets: number;
  bookmarks: number;
};

type AnalyticsPayload = {
  ok?: boolean;
  activity?: {
    used: number;
    limit: number;
    remaining: number;
    can_watch: boolean;
    planKey: string;
  };
  totals?: {
    posts: number;
    originals: number;
    replies: number;
    quotes: number;
    reposts: number;
    views: number;
    likes: number;
    replyCount: number;
    retweets: number;
    bookmarks: number;
  };
  series?: Array<{ day: string; posts: number; views: number; likes: number }>;
  kinds?: Array<{ key: OwnPostKind; count: number }>;
  top?: AnalyticsPost[];
  error?: string;
  message?: string;
};

const KIND_LABEL: Record<OwnPostKind, string> = {
  original: "Originals",
  reply: "Replies",
  quote: "Quotes",
  repost: "Reposts",
};

const KIND_COLOR: Record<OwnPostKind, string> = {
  original: "var(--accent)",
  reply: "#d4a574",
  quote: "#7ea88f",
  repost: "#c989b0",
};

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}m`;
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`;
  if (abs >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function shortDay(isoDay: string): string {
  const [, m, d] = isoDay.split("-");
  return m && d ? `${Number(m)}/${Number(d)}` : isoDay;
}

function clipText(text: string | null, n = 140): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "(no text)";
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function SeriesChart({
  series,
}: {
  series: Array<{ day: string; posts: number; views: number; likes: number }>;
}) {
  const width = 640;
  const height = 168;
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(series.length, 1);
  const maxViews = Math.max(1, ...series.map((p) => p.views));
  const maxLikes = Math.max(1, ...series.map((p) => p.likes));
  const xAt = (i: number) =>
    padL + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const yViews = (v: number) => padT + innerH - (v / maxViews) * innerH;
  const yLikes = (v: number) => padT + innerH - (v / maxLikes) * innerH;

  const viewLine = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yViews(p.views).toFixed(1)}`)
    .join(" ");
  const likeLine = series
    .map((p, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yLikes(p.likes).toFixed(1)}`)
    .join(" ");
  const area =
    series.length > 1
      ? `${viewLine} L ${xAt(n - 1).toFixed(1)} ${(padT + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
      : "";
  const labelStep = Math.max(1, Math.ceil(n / 7));

  return (
    <svg
      className="analytics-svg"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Views and likes over the last 30 days"
    >
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line
          key={f}
          className="analytics-grid"
          x1={padL}
          x2={padL + innerW}
          y1={padT + innerH * (1 - f)}
          y2={padT + innerH * (1 - f)}
        />
      ))}
      {area ? <path className="analytics-area" d={area} /> : null}
      {series.length > 1 ? (
        <path className="analytics-line analytics-line-views" d={viewLine} fill="none" />
      ) : null}
      {series.length > 1 ? (
        <path className="analytics-line analytics-line-likes" d={likeLine} fill="none" />
      ) : null}
      {series.map((p, i) => (
        <circle
          key={`v-${p.day}`}
          className="analytics-dot-views"
          cx={xAt(i)}
          cy={yViews(p.views)}
          r={2.4}
        >
          <title>
            {p.day}: {p.views} views · {p.likes} likes · {p.posts} posts
          </title>
        </circle>
      ))}
      {series.map((p, i) =>
        i % labelStep === 0 || i === n - 1 ? (
          <text
            key={`t-${p.day}`}
            className="analytics-axis-label"
            x={xAt(i)}
            y={height - 6}
            textAnchor="middle"
          >
            {shortDay(p.day)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

function KindDonut({
  kinds,
}: {
  kinds: Array<{ key: OwnPostKind; count: number }>;
}) {
  const total = kinds.reduce((s, k) => s + k.count, 0) || 1;
  const cx = 88;
  const cy = 88;
  const r = 58;
  const stroke = 22;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const slices = kinds.map((k) => {
    const len = (k.count / total) * circ;
    const slice = { ...k, len, offset };
    offset += len;
    return slice;
  });

  return (
    <div className="analytics-donut-wrap">
      <svg
        className="analytics-donut"
        viewBox="0 0 176 176"
        role="img"
        aria-label="Post kind mix"
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="var(--border)"
          strokeWidth={stroke}
        />
        {slices.map((s) => (
          <circle
            key={s.key}
            cx={cx}
            cy={cy}
            r={r}
            fill="none"
            stroke={KIND_COLOR[s.key]}
            strokeWidth={stroke}
            strokeDasharray={`${s.len} ${circ - s.len}`}
            strokeDashoffset={-s.offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          >
            <title>
              {KIND_LABEL[s.key]}: {s.count}
            </title>
          </circle>
        ))}
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          className="analytics-donut-total"
        >
          {fmt(total)}
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          className="analytics-donut-sub"
        >
          posts
        </text>
      </svg>
      <ul className="analytics-legend">
        {kinds.map((k) => (
          <li key={k.key}>
            <span
              className="analytics-swatch"
              style={{ background: KIND_COLOR[k.key] }}
            />
            <span>{KIND_LABEL[k.key]}</span>
            <strong>{k.count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MixBars({
  likes,
  replies,
  retweets,
  bookmarks,
}: {
  likes: number;
  replies: number;
  retweets: number;
  bookmarks: number;
}) {
  const rows = [
    { key: "Likes", value: likes, color: "var(--accent)" },
    { key: "Replies", value: replies, color: "#d4a574" },
    { key: "Reposts", value: retweets, color: "#c989b0" },
    { key: "Bookmarks", value: bookmarks, color: "#7ea88f" },
  ];
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="analytics-mix">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="analytics-mix-label">{r.key}</span>
          <span className="analytics-mix-track">
            <span
              style={{
                width: `${Math.max(r.value > 0 ? 4 : 0, (r.value / max) * 100)}%`,
                background: r.color,
              }}
            />
          </span>
          <strong>{fmt(r.value)}</strong>
        </li>
      ))}
    </ul>
  );
}

export function Analytics(props: { onBack: () => void }) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);

  async function load() {
    setBusy(true);
    setError("");
    try {
      const res = await apiFetch("/api/analytics");
      const json = (await res.json()) as AnalyticsPayload;
      if (!res.ok || json.ok === false) {
        setError(json.message || json.error || `Could not load analytics (${res.status})`);
        setData(null);
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setData(null);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const totals = data?.totals;
  const series = data?.series ?? [];
  const kinds = data?.kinds ?? [];
  const top = data?.top ?? [];
  const activity = data?.activity;
  const empty = !busy && !error && (totals?.posts ?? 0) === 0;

  return (
    <section className="panel settings-pane analytics-pane">
      <div className="settings-head">
        <h2>Analytics</h2>
        <div className="analytics-head-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => void load()}>
            {busy ? "Loading…" : "Refresh"}
          </button>
          <button type="button" className="ghost" onClick={props.onBack}>
            Back
          </button>
        </div>
      </div>
      <p className="status settings-lede">
        Every public tweet you send — originals and replies — lands here. Views,
        likes, replies, reposts, and bookmarks are sampled at post time, 1h, and
        24h. That watch is priced into your monthly credits.
      </p>

      {error ? (
        <p className="status danger" role="alert">
          {error}
        </p>
      ) : null}

      {activity ? (
        <div className="analytics-watch">
          <div className="credit-meter-head">
            <span className="usage-stat-label">Watch today (UTC)</span>
            <strong className="usage-stat-value">
              {activity.used.toLocaleString()} / {activity.limit.toLocaleString()}
            </strong>
          </div>
          <div className="credit-meter-bar" aria-hidden="true">
            <span
              style={{
                width: `${
                  activity.limit > 0
                    ? Math.min(100, Math.round((activity.used / activity.limit) * 100))
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {empty ? (
        <div className="analytics-empty">
          <p>No watched posts yet.</p>
          <p className="settings-help">
            Save your X handle, then post in public. The hourly search fills
            this from the last day — no second pull. Protected accounts can
            still use Mark interacted.
          </p>
        </div>
      ) : null}

      {totals && totals.posts > 0 ? (
        <>
          <div className="analytics-hero">
            {(
              [
                ["Posts", totals.posts],
                ["Views", totals.views],
                ["Likes", totals.likes],
                ["Replies", totals.replyCount],
                ["Reposts", totals.retweets],
                ["Bookmarks", totals.bookmarks],
              ] as const
            ).map(([label, value]) => (
              <article key={label} className="analytics-stat">
                <span>{label}</span>
                <strong>{fmt(value)}</strong>
              </article>
            ))}
          </div>

          <div className="analytics-grid">
            <article className="analytics-card analytics-card-wide">
              <header>
                <h3>Signal</h3>
                <p>
                  <span className="analytics-key analytics-key-views" /> views
                  <span className="analytics-key analytics-key-likes" /> likes
                </p>
              </header>
              {series.length ? (
                <SeriesChart series={series} />
              ) : (
                <p className="settings-help">Not enough days yet.</p>
              )}
            </article>

            <article className="analytics-card">
              <header>
                <h3>Mix</h3>
                <p>How you post</p>
              </header>
              {kinds.length ? (
                <KindDonut kinds={kinds} />
              ) : (
                <p className="settings-help">No kind split yet.</p>
              )}
            </article>

            <article className="analytics-card">
              <header>
                <h3>Engagement</h3>
                <p>Latest snapshot totals</p>
              </header>
              <MixBars
                likes={totals.likes}
                replies={totals.replyCount}
                retweets={totals.retweets}
                bookmarks={totals.bookmarks}
              />
            </article>
          </div>

          <article className="analytics-card analytics-top">
            <header>
              <h3>Top posts</h3>
              <p>Ranked by latest views</p>
            </header>
            <ol className="analytics-top-list">
              {top.map((post, i) => {
                const maxViews = Math.max(1, top[0]?.views ?? 1);
                return (
                  <li key={post.id}>
                    <span className="analytics-rank">{i + 1}</span>
                    <div className="analytics-top-body">
                      <p>{clipText(post.text)}</p>
                      <div className="analytics-top-meta">
                        <span
                          className="analytics-kind"
                          style={{ color: KIND_COLOR[post.kind] }}
                        >
                          {KIND_LABEL[post.kind]}
                        </span>
                        <span>{post.postedAt.slice(0, 10)}</span>
                        {post.url ? (
                          <a href={post.url} target="_blank" rel="noreferrer">
                            Open
                          </a>
                        ) : null}
                      </div>
                      <span className="analytics-top-bar" aria-hidden="true">
                        <span
                          style={{
                            width: `${Math.max(6, (post.views / maxViews) * 100)}%`,
                          }}
                        />
                      </span>
                    </div>
                    <dl className="analytics-top-metrics">
                      <div>
                        <dt>Views</dt>
                        <dd>{fmt(post.views)}</dd>
                      </div>
                      <div>
                        <dt>Likes</dt>
                        <dd>{fmt(post.likes)}</dd>
                      </div>
                      <div>
                        <dt>Replies</dt>
                        <dd>{fmt(post.replies)}</dd>
                      </div>
                      <div>
                        <dt>RTs</dt>
                        <dd>{fmt(post.retweets)}</dd>
                      </div>
                      <div>
                        <dt>Marks</dt>
                        <dd>{fmt(post.bookmarks)}</dd>
                      </div>
                    </dl>
                  </li>
                );
              })}
            </ol>
          </article>
        </>
      ) : null}
    </section>
  );
}
