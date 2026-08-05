import {
  formatPeriodLabel,
  type ActivityBucket,
  type ActivitySeriesPoint,
} from "./lib/activityStats";

type Props = {
  series: ActivitySeriesPoint[];
  bucket: ActivityBucket;
};

/**
 * Lightweight dual-series SVG: interaction bars + views line.
 * Sized by the parent reserved box (viewBox scales).
 */
export function ActivityChart({ series, bucket }: Props) {
  const width = 600;
  const height = 120;
  const padL = 28;
  const padR = 8;
  const padT = 10;
  const padB = 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(series.length, 1);
  const gap = 2;
  const barW = Math.max(2, (innerW - gap * (n - 1)) / n);

  let maxIx = 1;
  let maxViews = 1;
  for (const p of series) {
    if (p.interactions > maxIx) maxIx = p.interactions;
    if (p.views > maxViews) maxViews = p.views;
  }

  const points: Array<{ x: number; y: number; p: ActivitySeriesPoint }> = [];
  const bars: Array<{ x: number; h: number; p: ActivitySeriesPoint }> = [];

  series.forEach((p, i) => {
    const x = padL + i * (barW + gap);
    const h = (p.interactions / maxIx) * innerH;
    bars.push({ x, h, p });
    const cx = x + barW / 2;
    const y = padT + innerH - (p.views / maxViews) * innerH;
    points.push({ x: cx, y, p });
  });

  const lineD = points
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");

  // Label every ~7th day or every week.
  const labelStep = bucket === "week" ? 1 : Math.max(1, Math.ceil(n / 7));

  return (
    <svg
      className="activity-chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Marked interactions and sampled views over time"
    >
      <line
        className="activity-chart-axis"
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
      />
      {bars.map(({ x, h, p }) => (
        <rect
          key={`b-${p.period}`}
          className="activity-chart-bar"
          x={x}
          y={padT + innerH - h}
          width={barW}
          height={Math.max(h, p.interactions > 0 ? 1.5 : 0)}
        >
          <title>
            {p.period}: {p.interactions} marked · {p.views} views
          </title>
        </rect>
      ))}
      {points.length > 1 ? (
        <path className="activity-chart-line" d={lineD} fill="none" />
      ) : null}
      {points.map((pt) =>
        pt.p.views > 0 || pt.p.interactions > 0 ? (
          <circle
            key={`c-${pt.p.period}`}
            className="activity-chart-dot"
            cx={pt.x}
            cy={pt.y}
            r={2.2}
          >
            <title>
              {pt.p.period}: {pt.p.views} views
            </title>
          </circle>
        ) : null,
      )}
      {series.map((p, i) =>
        i % labelStep === 0 || i === n - 1 ? (
          <text
            key={`t-${p.period}`}
            className="activity-chart-label"
            x={padL + i * (barW + gap) + barW / 2}
            y={height - 6}
            textAnchor="middle"
          >
            {formatPeriodLabel(p.period, bucket)}
          </text>
        ) : null,
      )}
    </svg>
  );
}
