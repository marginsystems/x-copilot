import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SCOUT_VISIT_LEAVE_MS, SCOUT_VISIT_STAY_MS, SCOUT_VISIT_TOTAL_MS } from "./scoutVisit.ts";
import { SCOUT_SPRITE_SIZE, scoutLook, type ScoutLook } from "./scoutCompanion.ts";
import {
  paintScout,
  SCOUT_DESK_PALETTE,
  SCOUT_PALETTE,
  startScoutStage,
  type ScoutVisitState,
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

  it("starts one hop when the reply count increases and again when it is cheered", () => {
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
    assert.equal(runFrame(2_080), groundedTop);
    stage.cheer();
    runFrame(3_120);
    const cheerTop = runFrame(3_570);
    stage.stop();

    assert.equal(groundedTop - hopTop, awake.cell * 4);
    assert.equal(groundedTop - cheerTop, awake.cell * 4);
  }).catch(assert.fail);
});

function paintVisit(look: ScoutLook, visit: ScoutVisitState | null, width = 320, timeMs = 0) {
  const { brush, fills } = recordingBrush();
  paintScout(brush, { width, height: 132, palette: SCOUT_PALETTE, look, motion: { hopStartMs: null }, timeMs, still: false, visit });
  return fills;
}


await describe("desk Scout palette", () => {
  it("is warm and keeps eyes and the scarf readable against the body", () => {
    assert.notEqual(SCOUT_DESK_PALETTE.body, SCOUT_PALETTE.body);
    assert.notEqual(SCOUT_DESK_PALETTE.scarf, SCOUT_DESK_PALETTE.body);
    assert.notEqual(SCOUT_DESK_PALETTE.ink, SCOUT_DESK_PALETTE.body);
    assert.notEqual(SCOUT_DESK_PALETTE.outline, SCOUT_DESK_PALETTE.body);
  }).catch(assert.fail);
});

await describe("paintScout visits", () => {
  const awake = scoutLook({ connected: true, repliesToday: 0, stats: { level: 1, streak: 0 } });
  const size = SCOUT_SPRITE_SIZE * awake.cell;

  it("hides the departed desk Scout while the guest is away and draws it again after", () => {
    const away = paintVisit(awake, { role: "depart", side: "left", elapsedMs: 2_000 });
    assert.equal(away.filter((fill) => fill.color === SCOUT_PALETTE.body).length, 0);
    const back = paintVisit(awake, { role: "depart", side: "left", elapsedMs: SCOUT_VISIT_TOTAL_MS });
    assert.ok(back.some((fill) => fill.color === SCOUT_PALETTE.body));
  }).catch(assert.fail);

  it("sends the desk Scout out through the chosen edge", () => {
    const leftEnd = paintVisit(awake, { role: "depart", side: "left", elapsedMs: SCOUT_VISIT_LEAVE_MS - 1 });
    assert.ok(Math.max(...leftEnd.filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.x + fill.w)) <= size);
    const rightEnd = paintVisit(awake, { role: "depart", side: "right", elapsedMs: SCOUT_VISIT_LEAVE_MS - 1 });
    assert.ok(Math.min(...rightEnd.filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.x)) >= 320 - size);
  }).catch(assert.fail);

  it("draws no guest before it is due", () => {
    const fills = paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs: 100 });
    assert.equal(fills.filter((fill) => fill.color === SCOUT_DESK_PALETTE.body).length, 0);
  }).catch(assert.fail);

  it("stands the resident and the guest side by side without overlap while greeting", () => {
    const fills = paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs: 2_000 });
    const resident = fills.filter((fill) => fill.color === SCOUT_PALETTE.outline);
    const guest = fills.filter((fill) => fill.color === SCOUT_DESK_PALETTE.outline);
    assert.ok(resident.length > 0 && guest.length > 0);
    const residentRight = Math.max(...resident.map((fill) => fill.x + fill.w));
    assert.ok(residentRight <= Math.min(...guest.map((fill) => fill.x)));
  }).catch(assert.fail);

  it("mirrors the sides when the guest enters from the left edge", () => {
    const fills = paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "left", elapsedMs: 2_000 });
    const resident = fills.filter((fill) => fill.color === SCOUT_PALETTE.outline);
    const guest = fills.filter((fill) => fill.color === SCOUT_DESK_PALETTE.outline);
    assert.ok(Math.max(...guest.map((fill) => fill.x + fill.w)) <= Math.min(...resident.map((fill) => fill.x)));
  }).catch(assert.fail);

  it("brings the guest in from beyond the entry edge", () => {
    const fills = paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs: SCOUT_VISIT_LEAVE_MS + 100 });
    const guest = fills.filter((fill) => fill.color === SCOUT_DESK_PALETTE.body);
    assert.ok(Math.max(...guest.map((fill) => fill.x)) > 320 - size);
  }).catch(assert.fail);

  it("shows a speech bubble above the guest first and the resident second", () => {
    const bubbleInk = (elapsedMs: number) =>
      paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs }).filter(
        (fill) => fill.w === 2 && fill.h === 2,
      );
    const guestFirst = bubbleInk(1_900);
    const residentSecond = bubbleInk(3_400);
    const none = bubbleInk(1_000);
    assert.equal(none.length, 0);
    assert.ok(guestFirst.some((fill) => fill.color === SCOUT_DESK_PALETTE.outline));
    assert.ok(residentSecond.some((fill) => fill.color === SCOUT_PALETTE.outline));
    assert.ok(!guestFirst.some((fill) => fill.color === SCOUT_PALETTE.outline));
    assert.ok(!residentSecond.some((fill) => fill.color === SCOUT_DESK_PALETTE.outline));
  }).catch(assert.fail);

  it("ignores a visit in a still frame", () => {
    const { brush, fills } = recordingBrush();
    paintScout(brush, { width: 320, height: 132, palette: SCOUT_PALETTE, look: awake, motion: { hopStartMs: null }, timeMs: 0, still: true, visit: { role: "depart", side: "left", elapsedMs: 2_000 } });
    assert.ok(fills.some((fill) => fill.color === SCOUT_PALETTE.body));
  }).catch(assert.fail);

  it("keeps everything inside the stage while hosting", () => {
    for (const elapsedMs of [0, 950, 1_800, 2_500, 3_400, 4_300, 5_000]) {
      const fills = paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs });
      assert.ok(fills.every((fill) => fill.y >= 0 && fill.y + fill.h <= 132), `elapsed ${elapsedMs}`);
    }
  }).catch(assert.fail);

  it("walks the guest back out through the entry edge and returns the resident to its patrol", () => {
    const host = (elapsedMs: number) =>
      paintVisit(awake, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs });
    const span = (fills: Fill[], color: string) => {
      const body = fills.filter((fill) => fill.color === color);
      return {
        count: body.length,
        left: Math.min(...body.map((fill) => fill.x)),
        center: (Math.min(...body.map((fill) => fill.x)) + Math.max(...body.map((fill) => fill.x + fill.w))) / 2,
      };
    };
    const exitEndMs = SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS;
    const greeting = span(host(2_500), SCOUT_DESK_PALETTE.body);
    const leaving = span(host(exitEndMs - 450), SCOUT_DESK_PALETTE.body);
    const almostOut = span(host(exitEndMs - 100), SCOUT_DESK_PALETTE.body);
    assert.ok(leaving.count > 0);
    assert.ok(leaving.left > greeting.left);
    assert.ok(almostOut.left > leaving.left);
    assert.equal(span(host(exitEndMs + 10), SCOUT_DESK_PALETTE.body).count, 0);

    const patrolCenter = span(paintVisit(awake, null), SCOUT_PALETTE.outline).center;
    const hostingCenter = span(host(2_500), SCOUT_PALETTE.outline).center;
    const walkingHome = span(host(exitEndMs + 450), SCOUT_PALETTE.outline).center;
    assert.ok(hostingCenter < patrolCenter);
    assert.ok(walkingHome > hostingCenter && walkingHome < patrolCenter);
    assert.equal(span(host(SCOUT_VISIT_TOTAL_MS), SCOUT_PALETTE.outline).center, patrolCenter);
  }).catch(assert.fail);

  it("keeps both greeting bubbles inside the stage at the maximum Scout size", () => {
    const large = scoutLook({ connected: true, repliesToday: 0, stats: { level: 7, streak: 0 } });
    for (const elapsedMs of [2_250, 3_150]) {
      const fills = paintVisit(large, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs }, 320, 520);
      assert.ok(fills.every((fill) => fill.y >= 0 && fill.y + fill.h <= 132), `elapsed ${elapsedMs}`);
    }
  }).catch(assert.fail);
});

function fakeStage(width: number, matches = false) {
  const { brush, fills } = recordingBrush();
  const context = Object.assign(brush, { setTransform: () => {}, imageSmoothingEnabled: false });
  let pendingFrame: ((timeMs: number) => void) | undefined;
  const view: ScoutStageView = {
    devicePixelRatio: 1,
    matchMedia: () => ({ matches }),
    requestAnimationFrame(callback) {
      pendingFrame = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const canvas: ScoutStageCanvas = { clientWidth: width, width: 0, height: 0, ownerDocument: { defaultView: view }, getContext: () => context };
  const runFrame = (timeMs: number) => {
    const callback = pendingFrame;
    assert.ok(callback);
    pendingFrame = undefined;
    fills.length = 0;
    callback(timeMs);
    return fills.slice();
  };
  return { canvas, runFrame };
}

await describe("startScoutStage visits", () => {
  const awake = scoutLook({ connected: true, repliesToday: 0, stats: { level: 1, streak: 0 } });
  const asleep = scoutLook({ connected: false, repliesToday: 0, stats: null });
  const bodyCount = (fills: Fill[], color: string) => fills.filter((fill) => fill.color === color).length;

  it("runs the desk Scout out and back on its own clock, then patrols again", () => {
    const { canvas, runFrame } = fakeStage(320);
    const stage = startScoutStage(canvas, { look: awake });
    assert.ok(bodyCount(runFrame(1_000), SCOUT_PALETTE.body) > 0);
    assert.equal(stage.depart("left"), true);
    assert.ok(bodyCount(runFrame(2_000), SCOUT_PALETTE.body) > 0);
    assert.equal(bodyCount(runFrame(2_000 + SCOUT_VISIT_LEAVE_MS + 500), SCOUT_PALETTE.body), 0);
    const returnStart = runFrame(2_000 + SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS + 450).filter((fill) => fill.color === SCOUT_PALETTE.body);
    const returnEnd = runFrame(2_000 + SCOUT_VISIT_LEAVE_MS + SCOUT_VISIT_STAY_MS + 700).filter((fill) => fill.color === SCOUT_PALETTE.body);
    const center = (fills: Fill[]) => (Math.min(...fills.map((fill) => fill.x)) + Math.max(...fills.map((fill) => fill.x + fill.w))) / 2;
    const returnStartCenter = center(returnStart);
    const returnEndCenter = center(returnEnd);
    const patrolStartCenter = center(paintVisit(awake, null, 320, 6_950).filter((fill) => fill.color === SCOUT_PALETTE.body));
    const patrolEndCenter = center(paintVisit(awake, null, 320, 7_200).filter((fill) => fill.color === SCOUT_PALETTE.body));
    assert.ok(returnStart.length > 0);
    assert.ok(returnStartCenter < patrolStartCenter);
    assert.ok(returnEndCenter > returnStartCenter && returnEndCenter < patrolEndCenter);
    assert.ok(bodyCount(runFrame(2_000 + SCOUT_VISIT_TOTAL_MS + 10), SCOUT_PALETTE.body) > 0);
    assert.equal(stage.depart("right"), true);
    stage.stop();
  }).catch(assert.fail);

  it("hosts a guest once and refuses a second visit while one runs", () => {
    const { canvas, runFrame } = fakeStage(320);
    const stage = startScoutStage(canvas, { look: awake });
    assert.equal(stage.host(SCOUT_DESK_PALETTE, "right"), true);
    assert.equal(stage.host(SCOUT_DESK_PALETTE, "right"), false);
    runFrame(0);
    assert.ok(bodyCount(runFrame(2_000), SCOUT_DESK_PALETTE.body) > 0);
    stage.stop();
  }).catch(assert.fail);

  it("refuses visits while asleep or under reduced motion", () => {
    const sleepingStage = fakeStage(320);
    const sleeping = startScoutStage(sleepingStage.canvas, { look: asleep });
    assert.equal(sleeping.host(SCOUT_DESK_PALETTE, "right"), false);
    assert.equal(sleeping.depart("left"), false);
    const asleepTop = Math.min(...sleepingStage.runFrame(0).filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.y));
    sleeping.cheer();
    sleepingStage.runFrame(450);
    const afterCheerTop = Math.min(...sleepingStage.runFrame(900).filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.y));
    assert.equal(afterCheerTop, asleepTop);
    const still = startScoutStage(fakeStage(320, true).canvas, { look: awake });
    assert.equal(still.host(SCOUT_DESK_PALETTE, "right"), false);
    assert.equal(still.depart("left"), false);
  }).catch(assert.fail);
});
