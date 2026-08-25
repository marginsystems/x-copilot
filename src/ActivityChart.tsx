import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  activityChartTipDetail,
  formatPeriodLabel,
  formatPeriodTip,
  viewsLineAltitude,
  type ActivityBucket,
  type ActivitySeriesPoint,
} from "./lib/activityStats";
import {
  estimateTipWidth,
  tipAnchor,
  tipEdge,
  tipFlipBelow,
  type TipEdge,
} from "./lib/tipEdge";

type Props = {
  series: ActivitySeriesPoint[];
  bucket: ActivityBucket;
  /** Thin sparkline for a collapsed flight path. */
  compact?: boolean;
};

type BuiltPoint = {
  x: number;
  y: number;
  barX: number;
  barH: number;
  p: ActivitySeriesPoint;
  held: boolean;
  lineViews: number;
};

function buildPoints(
  series: ActivitySeriesPoint[],
  innerH: number,
  padL: number,
  padT: number,
  barW: number,
  gap: number,
): BuiltPoint[] {
  let maxIx = 1;
  let lastSampledViews = 0;
  let maxLineViews = 1;
  for (const p of series) {
    if (p.interactions > maxIx) maxIx = p.interactions;
  }
  for (const p of series) {
    const alt = viewsLineAltitude(p, lastSampledViews);
    if (!alt.held) lastSampledViews = alt.views;
    if (alt.views > maxLineViews) maxLineViews = alt.views;
  }
  if (maxLineViews < 1) maxLineViews = 1;
  lastSampledViews = 0;

  return series.map((p, i) => {
    const barX = padL + i * (barW + gap);
    const barH = (p.interactions / maxIx) * innerH;
    const alt = viewsLineAltitude(p, lastSampledViews);
    if (!alt.held) lastSampledViews = alt.views;
    return {
      x: barX + barW / 2,
      y: padT + innerH - (alt.views / maxLineViews) * innerH,
      barX,
      barH,
      p,
      held: alt.held,
      lineViews: alt.views,
    };
  });
}

/**
 * Lightweight dual-series SVG: interaction bars + views line.
 * Sized by the parent reserved box (viewBox scales).
 */
export function ActivityChart({ series, bucket, compact = false }: Props) {
  const width = 600;
  const height = compact ? 44 : 120;
  const padL = compact ? 6 : 28;
  const padR = 8;
  const padT = compact ? 4 : 10;
  const padB = compact ? 4 : 22;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const n = Math.max(series.length, 1);
  const gap = 2;
  const barW = Math.max(2, (innerW - gap * (n - 1)) / n);
  const points = buildPoints(series, innerH, padL, padT, barW, gap);
  const labelStep = bucket === "week" ? 1 : Math.max(1, Math.ceil(n / 7));
  const [active, setActive] = useState<string | null>(null);

  const lineD = points
    .map((pt, i) => `${i === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");
  const areaD =
    points.length > 1
      ? `${lineD} L ${points[points.length - 1]!.x.toFixed(1)} ${(padT + innerH).toFixed(1)} L ${points[0]!.x.toFixed(1)} ${(padT + innerH).toFixed(1)} Z`
      : "";

  const svg = (
    <svg
      className="activity-chart-svg"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Flight path of marked replies and sampled views"
    >
      <line
        className="activity-chart-axis"
        x1={padL}
        y1={padT + innerH}
        x2={padL + innerW}
        y2={padT + innerH}
      />
      {points.map((pt) => (
        <rect
          key={`b-${pt.p.period}`}
          className={
            !compact && active === pt.p.period
              ? "activity-chart-bar is-active"
              : "activity-chart-bar"
          }
          x={pt.barX}
          y={padT + innerH - pt.barH}
          width={barW}
          height={Math.max(pt.barH, pt.p.interactions > 0 ? 1.5 : 0)}
        >
          {compact ? (
            <title>
              {`${formatPeriodTip(pt.p.period, bucket)}: ${activityChartTipDetail(pt.p.interactions, pt.p.views, false)}`}
            </title>
          ) : null}
        </rect>
      ))}
      {areaD ? <path className="activity-chart-area" d={areaD} /> : null}
      {points.length > 1 ? (
        <path className="activity-chart-line" d={lineD} fill="none" />
      ) : null}
      {points.map((pt) =>
        pt.p.views > 0 || pt.p.interactions > 0 ? (
          <circle
            key={`c-${pt.p.period}`}
            className={
              [
                "activity-chart-dot",
                pt.held ? "activity-chart-dot-held" : "",
                !compact && active === pt.p.period ? "is-active" : "",
              ]
                .filter(Boolean)
                .join(" ")
            }
            cx={pt.x}
            cy={pt.y}
            r={!compact && active === pt.p.period ? 3.4 : 2.2}
          >
            {compact ? (
              <title>
                {`${formatPeriodTip(pt.p.period, bucket)}: ${activityChartTipDetail(pt.p.interactions, pt.lineViews, pt.held)}`}
              </title>
            ) : null}
          </circle>
        ) : null,
      )}
      {!compact
        ? series.map((p, i) =>
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
          )
        : null}
      {!compact
        ? points.map((pt) => (
            <rect
              key={`h-${pt.p.period}`}
              className={
                active === pt.p.period
                  ? "activity-chart-hit is-active"
                  : "activity-chart-hit"
              }
              x={pt.barX}
              y={padT}
              width={barW + gap}
              height={innerH}
              aria-label={`${formatPeriodTip(pt.p.period, bucket)}: ${activityChartTipDetail(pt.p.interactions, pt.lineViews, pt.held)}`}
              onPointerEnter={(ev) => {
                if (ev.pointerType === "mouse") setActive(pt.p.period);
              }}
              onPointerUp={(ev) => {
                if (ev.pointerType === "mouse") return;
                setActive((cur) => (cur === pt.p.period ? null : pt.p.period));
              }}
            />
          ))
        : null}
    </svg>
  );

  if (compact) return svg;
  return (
    <ActivityChartTipHost
      width={width}
      height={height}
      points={points}
      bucket={bucket}
      active={active}
      onDismiss={() => setActive(null)}
    >
      {svg}
    </ActivityChartTipHost>
  );
}

function ActivityChartTipHost({
  width,
  height,
  points,
  bucket,
  active,
  onDismiss,
  children,
}: {
  width: number;
  height: number;
  points: BuiltPoint[];
  bucket: ActivityBucket;
  active: string | null;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState<TipEdge>("center");
  const [below, setBelow] = useState(false);
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const activePoint =
    active === null ? null : points.find((pt) => pt.p.period === active) ?? null;

  useLayoutEffect(() => {
    function place() {
      if (active === null || !wrapRef.current) return;
      const pt = points.find((p) => p.p.period === active);
      if (!pt) return;
      const box = wrapRef.current.getBoundingClientRect();
      const { x, y } = tipAnchor(
        box.left,
        box.top,
        box.width,
        box.height,
        pt.x,
        pt.y,
        width,
        height,
      );
      setAnchor({ x, y });
      const tipW = tipRef.current?.offsetWidth ?? estimateTipWidth(window.innerWidth);
      const tipH = tipRef.current?.offsetHeight ?? 44;
      setEdge(tipEdge(x, tipW, window.innerWidth));
      // 44 keeps the tip below the fixed .menu-toggle band (top 6px + 32px height).
      setBelow(tipFlipBelow(y, tipH, 44));
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [active, points, width, height]);

  useLayoutEffect(() => {
    if (active === null) return;
    function onDocPointer(ev: globalThis.PointerEvent) {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (wrapRef.current?.contains(t) || tipRef.current?.contains(t)) return;
      onDismiss();
    }
    document.addEventListener("pointerdown", onDocPointer);
    return () => document.removeEventListener("pointerdown", onDocPointer);
  }, [active, onDismiss]);

  return (
    <div
      ref={wrapRef}
      className="activity-chart"
      onPointerLeave={(ev) => {
        if (ev.pointerType === "mouse") onDismiss();
      }}
    >
      {children}
      {activePoint && active !== null
        ? createPortal(
            <div
              ref={tipRef}
              className={
                below
                  ? `activity-chart-tip is-tip-${edge} is-below`
                  : `activity-chart-tip is-tip-${edge}`
              }
              style={{ left: anchor.x, top: anchor.y }}
              role="status"
            >
              <strong>{formatPeriodTip(activePoint.p.period, bucket)}</strong>
              <span>
                {activityChartTipDetail(
                  activePoint.p.interactions,
                  activePoint.lineViews,
                  activePoint.held,
                )}
              </span>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
