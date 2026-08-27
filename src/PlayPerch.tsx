import type { ReactElement } from "react";
import type { PlayScene } from "./lib/play";
import type { PropId } from "./lib/playProps";
import { PLANE_MASK } from "./lib/pixelField";
import { PlayCopilot } from "./PlayCopilot";

/**
 * The Layer 2 room: additive SVG prop groups over the PR 3 perch scene.
 * Which ids appear is decided by playProps.ts; this file only draws.
 * Same idiom as PlayCopilot — 6px grid, tokens only, square everything.
 * Absent ids draw nothing. Room props are static apart from a short
 * fade-in that 99-motion.css zeroes; wearables live in the bird groups
 * so they hop, breathe and sleep with it.
 */

const STAGE_WIDTH = 168; // widened from 132 for the shelf column; bird untouched

function has(props: readonly PropId[], id: PropId): boolean {
  return props.includes(id);
}

/** Tiny paper plane: one 1.5px cell per PLANE_MASK `#`. */
function PaperPlane({ x, y }: { x: number; y: number }) {
  const cells: ReactElement[] = [];
  PLANE_MASK.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "#") continue;
      cells.push(
        <rect
          key={`${r}-${c}`}
          x={x + c * 1.5}
          y={y + r * 1.5}
          width="1.5"
          height="1.5"
        />,
      );
    }
  });
  return <g className="play-prop play-prop-paper">{cells}</g>;
}

/** One trophy family; taller cup and wider base per marks tier. */
const TROPHY_TIERS = [
  { id: "trophy_10", cx: 133.5, cupW: 6, cupH: 4.5, baseW: 7.5 },
  { id: "trophy_50", cx: 142.5, cupW: 6, cupH: 6, baseW: 7.5 },
  { id: "trophy_100", cx: 151.5, cupW: 7.5, cupH: 7.5, baseW: 9 },
  { id: "trophy_250", cx: 160.5, cupW: 9, cupH: 9, baseW: 10.5 },
] as const satisfies readonly {
  id: PropId;
  cx: number;
  cupW: number;
  cupH: number;
  baseW: number;
}[];

/** Base sits on the upper shelf board (y=33). */
function Trophy({
  cx,
  cupW,
  cupH,
  baseW,
}: {
  cx: number;
  cupW: number;
  cupH: number;
  baseW: number;
}) {
  return (
    <g className="play-prop">
      <rect
        className="play-prop-dim"
        x={cx - baseW / 2}
        y="31.5"
        width={baseW}
        height="1.5"
      />
      <rect className="play-prop-dim" x={cx - 0.75} y="30" width="1.5" height="1.5" />
      <rect
        className="play-prop-body"
        x={cx - cupW / 2}
        y={30 - cupH}
        width={cupW}
        height={cupH}
      />
      <rect
        className="play-prop-dim"
        x={cx - cupW / 2 + 0.75}
        y="28.5"
        width={cupW - 1.5}
        height="1.5"
      />
    </g>
  );
}

/** Shelf board with end brackets; boards only appear once they hold something. */
function ShelfBoard({ y }: { y: number }) {
  return (
    <g className="play-prop">
      <rect className="play-prop-frame" x="127.5" y={y} width="39" height="4.5" />
      <rect className="play-prop-frame" x="129" y={y + 4.5} width="3" height="3" />
      <rect className="play-prop-frame" x="162" y={y + 4.5} width="3" height="3" />
    </g>
  );
}

function roomProps(props: readonly PropId[]): ReactElement {
  const trophies = TROPHY_TIERS.filter((t) => has(props, t.id));
  const keepsakes =
    has(props, "logbook") || has(props, "postcard") || has(props, "plane");

  return (
    <>
      {has(props, "window") ? (
        <g className="play-prop">
          <rect className="play-prop-frame" x="7.5" y="12" width="16.5" height="16.5" />
          <rect className="play-prop-dim" x="9" y="13.5" width="13.5" height="13.5" />
          <rect className="play-prop-frame" x="15" y="13.5" width="1.5" height="13.5" />
          <rect className="play-prop-frame" x="9" y="19.5" width="13.5" height="1.5" />
        </g>
      ) : null}
      {has(props, "pennant") ? (
        <g className="play-prop">
          <rect className="play-prop-frame" x="94.5" y="10.5" width="1.5" height="13.5" />
          <path className="play-prop-body" d="M96 12 L114 16.5 L96 21 Z" />
        </g>
      ) : null}
      {has(props, "lamp_upgrade") ? (
        // Wider hood over the PR 3 hood plus a second glow rect; the two
        // glows stack under .is-lit, so the upgraded lamp reads brighter.
        <g className="play-prop">
          <rect className="play-lamp-glow" x="16.5" y="40.5" width="27" height="27" />
          <rect className="play-prop-frame" x="19.5" y="43.5" width="21" height="7.5" />
        </g>
      ) : null}
      {has(props, "second_bar") ? (
        <g className="play-prop">
          <rect
            className="play-prop-frame play-prop-behind"
            x="39"
            y="90"
            width="54"
            height="4.5"
          />
        </g>
      ) : null}
      {has(props, "nameplate") ? (
        <g className="play-prop">
          <rect className="play-prop-paper" x="55.5" y="79.5" width="21" height="3" />
          <rect className="play-prop-ink" x="58.5" y="80.25" width="7.5" height="1.5" />
          <rect className="play-prop-ink" x="67.5" y="80.25" width="6" height="1.5" />
        </g>
      ) : null}
      {trophies.length > 0 ? <ShelfBoard y={33} /> : null}
      {trophies.map((t) => (
        <Trophy key={t.id} cx={t.cx} cupW={t.cupW} cupH={t.cupH} baseW={t.baseW} />
      ))}
      {keepsakes ? <ShelfBoard y={58.5} /> : null}
      {has(props, "logbook") ? (
        <g className="play-prop">
          <rect className="play-prop-dim" x="129" y="48" width="6" height="10.5" />
          <rect className="play-prop-paper" x="129.75" y="50.25" width="4.5" height="2.25" />
        </g>
      ) : null}
      {has(props, "postcard") ? (
        <g className="play-prop">
          <rect className="play-prop-paper" x="139.5" y="51" width="10.5" height="7.5" />
          <rect className="play-prop-body" x="146.25" y="52.5" width="2.25" height="2.25" />
          <rect className="play-prop-bg" x="141" y="54.75" width="4.5" height="0.75" />
          <rect className="play-prop-bg" x="141" y="56.25" width="6" height="0.75" />
        </g>
      ) : null}
      {has(props, "plane") ? <PaperPlane x={152.25} y={51} /> : null}
    </>
  );
}

/** Rides .play-bird, outside the head: scarf at the neck, patch on the wing. */
function birdWearProps(props: readonly PropId[]): ReactElement {
  return (
    <>
      {has(props, "scarf") ? (
        <g className="play-wear">
          <rect className="play-prop-cloth" x="52.5" y="52.5" width="28.5" height="4.5" />
          <rect className="play-prop-cloth" x="55.5" y="57" width="4.5" height="9" />
          <rect className="play-prop-dim" x="55.5" y="64.5" width="4.5" height="1.5" />
        </g>
      ) : null}
      {has(props, "wing_patch") ? (
        // Mirrors .play-wing's celebrate rotation via .play-wing-patch CSS.
        <rect
          className="play-wear play-wing-patch"
          x="57"
          y="56.25"
          width="4.5"
          height="4.5"
        />
      ) : null}
    </>
  );
}

/** Rides .play-head so goggles and cap tilt with the nudge pose. */
function headWearProps(props: readonly PropId[]): ReactElement {
  return (
    <>
      {has(props, "goggles") ? (
        <g className="play-wear">
          <rect className="play-prop-ink" x="54" y="43.5" width="30" height="1.5" />
          <rect className="play-goggles-frame" x="68.25" y="41.25" width="9" height="9" />
        </g>
      ) : null}
      {has(props, "cap") ? (
        <g className="play-wear">
          <rect className="play-prop-dim" x="57" y="33" width="24" height="3" />
          <rect className="play-prop-dim" x="60" y="30" width="18" height="3" />
        </g>
      ) : null}
    </>
  );
}

export function PlayPerch({
  scene,
  props,
}: {
  scene: PlayScene;
  props: PropId[];
}) {
  return (
    <PlayCopilot
      scene={scene}
      stageWidth={STAGE_WIDTH}
      room={roomProps(props)}
      birdWear={birdWearProps(props)}
      headWear={headWearProps(props)}
    />
  );
}
