import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCOUT_SPRITE_SIZE, scoutLook, type ScoutLook } from "./scoutCompanion.ts";
import {
  paintScout,
  SCOUT_PALETTE,
  startScoutStage,
  type ScoutBrush,
  type ScoutStageCanvas,
  type ScoutStageView,
} from "./scoutCompanionStage.ts";

type Fill = { color: string; x: number; y: number; w: number; h: number };

function recordingBrush(): { brush: ScoutBrush; fills: Fill[] } {
  const fills: Fill[] = [];
  const gradient: CanvasGradient = { addColorStop: () => {} };
  const brush: ScoutBrush = {
    fillStyle: "",
    clearRect: () => {},
    createRadialGradient: () => gradient,
    fillRect(x, y, w, h) {
      if (typeof this.fillStyle === "string") fills.push({ color: this.fillStyle, x, y, w, h });
    },
  };
  return { brush, fills };
}

function paintStill(look: ScoutLook, width: number, height: number): Fill[] {
  const { brush, fills } = recordingBrush();
  paintScout(brush, {
    width,
    height,
    palette: SCOUT_PALETTE,
    look,
    motion: { hopStartMs: null },
    timeMs: 4_321,
    still: true,
  });
  return fills;
}

await describe("paintScout", () => {
  const awake = scoutLook({ connected: true, repliesToday: 0, stats: { level: 1, streak: 0 } });

  it("stands the still character centred on the ground line of any stage height", () => {
    const fills = paintStill(awake, 400, 116);
    const body = fills.filter((fill) => fill.color === SCOUT_PALETTE.body);
    const size = SCOUT_SPRITE_SIZE * awake.cell;
    const left = Math.min(...body.map((fill) => fill.x));
    const right = Math.max(...body.map((fill) => fill.x + fill.w));
    assert.equal(left + right, 400);
    assert.ok(right - left <= size);
    const feet = fills.filter((fill) => fill.color === SCOUT_PALETTE.outline);
    assert.equal(Math.max(...feet.map((fill) => fill.y + fill.h)), 106);
    assert.ok(fills.every((fill) => fill.y >= 0 && fill.y + fill.h <= 116));
  }).catch(assert.fail);

  it("draws the ground in the palette the surface passes", () => {
    const { brush, fills } = recordingBrush();
    paintScout(brush, {
      width: 300,
      height: 116,
      palette: { ...SCOUT_PALETTE, ground: "#ddd4c8" },
      look: awake,
      motion: { hopStartMs: null },
      timeMs: 0,
      still: true,
    });
    assert.deepEqual(fills.find((fill) => fill.color === "#ddd4c8"), { color: "#ddd4c8", x: 0, y: 106, w: 300, h: 1 });
  }).catch(assert.fail);

  it("lights sparkles only once the day has three replies", () => {
    const sparkleCount = (repliesToday: number) =>
      paintStill(scoutLook({ connected: true, repliesToday, stats: null }), 400, 132).filter(
        (fill) => fill.w === awake.cell * 3 && fill.h === awake.cell,
      ).length;
    assert.equal(sparkleCount(2), 0);
    assert.ok(sparkleCount(4) > 0);
  }).catch(assert.fail);

  it("starts one hop when the reply count increases", () => {
    const { brush, fills } = recordingBrush();
    const context = Object.assign(brush, {
      setTransform: () => {},
      imageSmoothingEnabled: false,
    });
    let pendingFrame: ((timeMs: number) => void) | undefined;
    const view: ScoutStageView = {
      devicePixelRatio: 1,
      matchMedia: () => ({ matches: false }),
      requestAnimationFrame(callback) {
        pendingFrame = callback;
        return 1;
      },
      cancelAnimationFrame: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const canvas: ScoutStageCanvas = {
      clientWidth: 280,
      width: 0,
      height: 0,
      ownerDocument: { defaultView: view },
      getContext: () => context,
    };
    const stage = startScoutStage(canvas, { look: awake });
    const runFrame = (timeMs: number) => {
      const callback = pendingFrame;
      assert.ok(callback);
      pendingFrame = undefined;
      fills.length = 0;
      callback(timeMs);
      return Math.min(...fills.filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.y));
    };
    const groundedTop = runFrame(0);
    stage.show(scoutLook({ connected: true, repliesToday: 1, stats: { level: 1, streak: 0 } }));
    runFrame(0);
    const hopTop = runFrame(450);
    stage.stop();

    assert.equal(groundedTop - hopTop, awake.cell * 4);
  }).catch(assert.fail);
});
