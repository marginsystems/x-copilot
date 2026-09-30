import { formatPctDelta, type InstrumentDelta } from "../lib/deskInstruments";
import { gaugeValueText, deltaSpoken, type DeskGaugeSpec } from "../lib/deskGaugeSpecs";
import {
  GAUGE_END_DEG,
  GAUGE_START_DEG,
  arcPath,
  fractionToAngle,
  gaugeFraction,
  gaugeHasValue,
  gaugeTicks,
  polarPoint,
  toneAt,
  zoneFractions,
} from "../lib/gaugeGeometry";

const CX = 50;
const CY = 46;
const R_BEZEL = 45;
const R_ZONE = 40;
const R_TRACK = 34;
const R_TICK_OUT = 29.5;
const R_TICK_MAJOR_IN = 24.5;
const R_TICK_MINOR_IN = 27.5;
const LABEL_DROP = 8;
const NEEDLE_LEN = 25;
const NEEDLE_TAIL = 5;

export function DialGauge({ spec }: { spec: DeskGaugeSpec }) {
  const value = spec.value;
  const has = gaugeHasValue(value);
  const fraction = gaugeFraction(spec.value, spec.min, spec.max);
  const angle = fractionToAngle(fraction);
  const tone =
    spec.tone !== undefined ? spec.tone : toneAt(spec.value, spec.zones);
  const ticks = gaugeTicks(spec.majorSegments, spec.minorPerSegment);
  const zones = zoneFractions(spec.zones, spec.min, spec.max);
  const className = [
    "dial-gauge",
    tone ? `is-${tone}` : "",
    has ? "" : "is-empty",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      role="meter"
      aria-label={spec.label}
      aria-valuemin={spec.min}
      aria-valuemax={spec.max}
      aria-valuenow={
        gaugeHasValue(value)
          ? Math.min(spec.max, Math.max(spec.min, value))
          : undefined
      }
      aria-valuetext={has ? gaugeValueText(spec) : `no reading, ${spec.unit}`}
      title={spec.note}
    >
      <svg className="dial-svg" viewBox="0 0 100 84" aria-hidden="true">
        <path
          className="dial-bezel"
          d={arcPath(CX, CY, R_BEZEL, GAUGE_START_DEG - 4, GAUGE_END_DEG + 4)}
        />
        {zones.map((zone) => (
          <path
            key={`${zone.tone}-${zone.from}`}
            className={`dial-zone is-${zone.tone}`}
            d={arcPath(
              CX,
              CY,
              R_ZONE,
              fractionToAngle(zone.from),
              fractionToAngle(zone.to),
            )}
          />
        ))}
        <path
          className="dial-track"
          d={arcPath(CX, CY, R_TRACK, GAUGE_START_DEG, GAUGE_END_DEG)}
        />
        {spec.showFill ? (
          <path
            className="dial-fill"
            d={arcPath(CX, CY, R_TRACK, GAUGE_START_DEG, GAUGE_END_DEG)}
            pathLength={100}
            strokeDasharray={`${fraction * 100} 100`}
          />
        ) : null}
        {ticks.map((tick) => {
          const from = polarPoint(
            CX,
            CY,
            tick.major ? R_TICK_MAJOR_IN : R_TICK_MINOR_IN,
            tick.deg,
          );
          const to = polarPoint(CX, CY, R_TICK_OUT, tick.deg);
          return (
            <line
              key={tick.fraction}
              className={tick.major ? "dial-tick is-major" : "dial-tick"}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
          );
        })}
        {spec.tickLabels.map((label) => {
          const end = polarPoint(CX, CY, R_TRACK, fractionToAngle(label.fraction));
          const at = { x: end.x, y: end.y + LABEL_DROP };
          return (
            <text
              key={label.fraction}
              className="dial-tick-label"
              x={at.x}
              y={at.y}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {label.text}
            </text>
          );
        })}
        <g
          className="dial-needle"
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
          }}
        >
          <line
            x1={CX - NEEDLE_TAIL}
            y1={CY}
            x2={CX + NEEDLE_LEN}
            y2={CY}
          />
        </g>
        <circle className="dial-hub" cx={CX} cy={CY} r={3} />
        <text
          className="dial-value"
          x={CX}
          y={74}
          textAnchor="middle"
        >
          {spec.valueText}
        </text>
      </svg>
      <span className="dial-gauge-label">{spec.label}</span>
      <span className="dial-gauge-deltas">
        {spec.delta ? <DeltaPills delta={spec.delta} /> : null}
      </span>
    </div>
  );
}

function DeltaPills({ delta }: { delta: InstrumentDelta }) {
  return (
    <>
      <DeltaPill pct={delta.pct24h} label="24h" />
      <DeltaPill pct={delta.pct7d} label="7d" />
    </>
  );
}

function DeltaPill({ pct, label }: { pct: number | null; label: string }) {
  const dir =
    pct === null ? "new" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const arrow = dir === "down" ? "↓" : dir === "flat" ? "–" : "↑";
  const text = formatPctDelta(pct);
  return (
    <span className={`desk-delta is-${dir}`} aria-label={deltaSpoken(pct, label)}>
      <span aria-hidden="true">{arrow}</span>
      {text ? ` ${text}` : dir === "new" ? " new" : " 0%"} {label}
    </span>
  );
}
