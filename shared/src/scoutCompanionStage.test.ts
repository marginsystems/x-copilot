import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SCOUT_VISIT_BACK_AT_MS,
  SCOUT_VISIT_EXIT_AT_MS,
  SCOUT_VISIT_GAP_PX,
  SCOUT_VISIT_GREET_AT_MS,
  SCOUT_VISIT_IN_AT_MS,
  SCOUT_VISIT_OUT_AT_MS,
  SCOUT_VISIT_PANEL_OUT_AT_MS,
  SCOUT_VISIT_SPEED,
  SCOUT_VISIT_TOTAL_MS,
} from "./scoutVisit.ts";
import { SCOUT_SPRITE_SIZE, scoutLook, type ScoutLook } from "./scoutCompanion.ts";
import {
  paintScout,
  SCOUT_DESK_PALETTE,
  SCOUT_IDLE_FRAME_MS,
  SCOUT_NAP_FRAME_MS,
  scoutFrameDue,
  SCOUT_GROUND_INSET,
  SCOUT_PALETTE,
  startScoutStage,
  type ScoutVisitState,
  type ScoutBrush,
  type ScoutPalette,
  type ScoutStageCanvas,
  type ScoutStageView,
} from "./scoutCompanionStage.ts";

type Fill = { color: string; x: number; y: number; w: number; h: number };

type Aura = { x: number; y: number };

function recordingBrush(): { brush: ScoutBrush; fills: Fill[]; auras: Aura[] } {
  const fills: Fill[] = [];
  const auras: Aura[] = [];
  const gradient: CanvasGradient = { addColorStop: () => {} };
  const brush: ScoutBrush = {
    fillStyle: "",
    clearRect: () => {},
    createRadialGradient: (_x0, _y0, _r0, x1, y1) => {
      auras.push({ x: x1, y: y1 });
      return gradient;
    },
    fillRect(x, y, w, h) {
      if (typeof this.fillStyle === "string") fills.push({ color: this.fillStyle, x, y, w, h });
    },
  };
  return { brush, fills, auras };
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

function paintVisit(look: ScoutLook, visit: ScoutVisitState | null, width = 320, timeMs = 0, palette = SCOUT_PALETTE) {
  const { brush, fills, auras } = recordingBrush();
  paintScout(brush, { width, height: 132, palette, look, motion: { hopStartMs: null }, timeMs, still: false, visit });
  return Object.assign(fills, { auras });
}

await describe("desk Scout palette", () => {
  it("is warm and keeps eyes and the scarf readable against the body", () => {
    assert.notEqual(SCOUT_DESK_PALETTE.body, SCOUT_PALETTE.body);
    assert.notEqual(SCOUT_DESK_PALETTE.scarf, SCOUT_DESK_PALETTE.body);
    assert.notEqual(SCOUT_DESK_PALETTE.ink, SCOUT_DESK_PALETTE.body);
    assert.notEqual(SCOUT_DESK_PALETTE.outline, SCOUT_DESK_PALETTE.body);
  }).catch(assert.fail);
});

const GUEST_TONES: ScoutPalette = {
  outline: "#010101",
  body: "#020202",
  highlight: "#030303",
  ink: "#040404",
  cheek: "#050505",
  scarf: "#060606",
  bulbOff: "#070707",
  bulbOn: "#080808",
  ground: "#090909",
  sleep: "#0a0a0a",
};
const DESK_TONES: ScoutPalette = {
  outline: "#111111",
  body: "#121212",
  highlight: "#131313",
  ink: "#141414",
  cheek: "#151515",
  scarf: "#161616",
  bulbOff: "#171717",
  bulbOn: "#181818",
  ground: "#191919",
  sleep: "#1a1a1a",
};

function visibleSpan(fills: Fill[], color: string, width: number) {
  const parts = fills.filter((fill) => fill.color === color && fill.x < width && fill.x + fill.w > 0);
  if (parts.length === 0) return null;
  return {
    left: Math.max(0, Math.min(...parts.map((fill) => fill.x))),
    right: Math.min(width, Math.max(...parts.map((fill) => fill.x + fill.w))),
  };
}

await describe("paintScout visits", () => {
  const awake = scoutLook({ connected: true, repliesToday: 0, stats: { level: 1, streak: 0 } });
  const size = SCOUT_SPRITE_SIZE * awake.cell;
  const ground = 132 - SCOUT_GROUND_INSET;
  const host = (elapsedMs: number, look = awake, entry: "left" | "right" = "right", guest = SCOUT_DESK_PALETTE) =>
    paintVisit(look, { role: "host", guest, entry, elapsedMs });

  it("hides the departed desk Scout while the guest is away and draws it again after", () => {
    const away = paintVisit(awake, { role: "depart", side: "left", elapsedMs: 2_000 });
    assert.equal(away.filter((fill) => fill.color === SCOUT_PALETTE.body).length, 0);
    const back = paintVisit(awake, { role: "depart", side: "left", elapsedMs: SCOUT_VISIT_TOTAL_MS });
    assert.ok(back.some((fill) => fill.color === SCOUT_PALETTE.body));
  }).catch(assert.fail);

  it("sends the desk Scout out through the chosen edge", () => {
    const leftEnd = paintVisit(awake, { role: "depart", side: "left", elapsedMs: SCOUT_VISIT_OUT_AT_MS - 1 });
    assert.ok(Math.max(...leftEnd.filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.x + fill.w)) <= size);
    const rightEnd = paintVisit(awake, { role: "depart", side: "right", elapsedMs: SCOUT_VISIT_OUT_AT_MS - 1 });
    assert.ok(Math.min(...rightEnd.filter((fill) => fill.color === SCOUT_PALETTE.body).map((fill) => fill.x)) >= 320 - size);
  }).catch(assert.fail);

  it("keeps the desk Scout half on the stage while it crosses the edge", () => {
    const crossing = paintVisit(awake, { role: "depart", side: "left", elapsedMs: SCOUT_VISIT_OUT_AT_MS + (size / 2 / SCOUT_VISIT_SPEED) });
    const span = visibleSpan(crossing, SCOUT_PALETTE.outline, 320);
    assert.ok(span);
    assert.ok(span.left === 0 && span.right > 0 && span.right < size);
  }).catch(assert.fail);

  it("draws no guest before it is due", () => {
    assert.equal(host(100).filter((fill) => fill.color === SCOUT_DESK_PALETTE.body).length, 0);
    assert.equal(host(SCOUT_VISIT_IN_AT_MS - 1).filter((fill) => fill.color === SCOUT_DESK_PALETTE.body).length, 0);
  }).catch(assert.fail);

  it("stands the resident and the guest side by side without overlap while greeting", () => {
    const fills = host(2_800);
    const resident = fills.filter((fill) => fill.color === SCOUT_PALETTE.outline);
    const guest = fills.filter((fill) => fill.color === SCOUT_DESK_PALETTE.outline);
    assert.ok(resident.length > 0 && guest.length > 0);
    const residentRight = Math.max(...resident.map((fill) => fill.x + fill.w));
    assert.ok(residentRight <= Math.min(...guest.map((fill) => fill.x)));
  }).catch(assert.fail);

  it("mirrors the sides when the guest enters from the left edge", () => {
    const fills = host(2_800, awake, "left");
    const resident = fills.filter((fill) => fill.color === SCOUT_PALETTE.outline);
    const guest = fills.filter((fill) => fill.color === SCOUT_DESK_PALETTE.outline);
    assert.ok(Math.max(...guest.map((fill) => fill.x + fill.w)) <= Math.min(...resident.map((fill) => fill.x)));
  }).catch(assert.fail);

  it("brings the guest in from beyond the entry edge as soon as its leading edge arrives", () => {
    const fromRight = host(SCOUT_VISIT_IN_AT_MS + 50).filter((fill) => fill.color === SCOUT_DESK_PALETTE.body);
    assert.ok(fromRight.length > 0);
    assert.ok(Math.min(...fromRight.map((fill) => fill.x)) >= 320 - SCOUT_VISIT_SPEED * 50 - size);
    assert.ok(Math.max(...fromRight.map((fill) => fill.x)) > 320 - size);
    const fromLeft = host(SCOUT_VISIT_IN_AT_MS + 50, awake, "left").filter((fill) => fill.color === SCOUT_DESK_PALETTE.body);
    assert.ok(Math.max(...fromLeft.map((fill) => fill.x + fill.w)) <= size);
  }).catch(assert.fail);

  it("shows a speech bubble above the guest first and the resident second", () => {
    const bubbleInk = (elapsedMs: number) => host(elapsedMs).filter((fill) => fill.w === 2 && fill.h === 2);
    const guestFirst = bubbleInk(SCOUT_VISIT_GREET_AT_MS + 100);
    const residentSecond = bubbleInk(SCOUT_VISIT_EXIT_AT_MS - 200);
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
    for (const elapsedMs of [0, 950, 1_800, 2_500, 3_400, 4_300, 5_000, SCOUT_VISIT_TOTAL_MS - 1]) {
      assert.ok(host(elapsedMs).every((fill) => fill.y >= 0 && fill.y + fill.h <= 132), `elapsed ${elapsedMs}`);
    }
  }).catch(assert.fail);

  it("walks the guest back out through the entry edge and returns the resident to its patrol", () => {
    const span = (fills: Fill[], color: string) => {
      const body = fills.filter((fill) => fill.color === color);
      return {
        count: body.length,
        left: Math.min(...body.map((fill) => fill.x)),
        center: (Math.min(...body.map((fill) => fill.x)) + Math.max(...body.map((fill) => fill.x + fill.w))) / 2,
      };
    };
    const greeting = span(host(2_800), SCOUT_DESK_PALETTE.body);
    const leaving = span(host(SCOUT_VISIT_PANEL_OUT_AT_MS - 150), SCOUT_DESK_PALETTE.body);
    const almostOut = span(host(SCOUT_VISIT_PANEL_OUT_AT_MS + 20), SCOUT_DESK_PALETTE.body);
    assert.ok(leaving.count > 0);
    assert.ok(leaving.left > greeting.left);
    assert.ok(almostOut.left > leaving.left);
    assert.equal(visibleSpan(host(SCOUT_VISIT_PANEL_OUT_AT_MS + size / SCOUT_VISIT_SPEED + 10), SCOUT_DESK_PALETTE.body, 320), null);

    const patrolCenter = span(paintVisit(awake, null), SCOUT_PALETTE.outline).center;
    const hostingCenter = span(host(2_800), SCOUT_PALETTE.outline).center;
    const walkingHome = span(host(SCOUT_VISIT_PANEL_OUT_AT_MS + 500), SCOUT_PALETTE.outline).center;
    assert.ok(hostingCenter < patrolCenter);
    assert.ok(walkingHome > hostingCenter && walkingHome < patrolCenter);
    assert.equal(span(host(SCOUT_VISIT_TOTAL_MS), SCOUT_PALETTE.outline).center, patrolCenter);
  }).catch(assert.fail);

  it("keeps both greeting bubbles inside the stage at the maximum Scout size", () => {
    const large = scoutLook({ connected: true, repliesToday: 0, stats: { level: 7, streak: 0 } });
    for (const elapsedMs of [2_400, 3_300]) {
      const fills = paintVisit(large, { role: "host", guest: SCOUT_DESK_PALETTE, entry: "right", elapsedMs }, 320, 520);
      assert.ok(fills.every((fill) => fill.y >= 0 && fill.y + fill.h <= 132), `elapsed ${elapsedMs}`);
    }
  }).catch(assert.fail);

  it("stands on the ground line at both ends of every crossing", () => {
    const feet = (fills: Fill[], color: string) => Math.max(...fills.filter((fill) => fill.color === color).map((fill) => fill.y + fill.h));
    const crossings = [
      paintVisit(awake, { role: "depart", side: "left", elapsedMs: SCOUT_VISIT_OUT_AT_MS - 1 }),
      paintVisit(awake, { role: "depart", side: "right", elapsedMs: SCOUT_VISIT_BACK_AT_MS + 1 }),
    ];
    for (const fills of crossings) assert.equal(feet(fills, SCOUT_PALETTE.outline), ground);
    const guestIn = host(SCOUT_VISIT_IN_AT_MS + 1);
    const guestOut = host(SCOUT_VISIT_PANEL_OUT_AT_MS);
    assert.equal(feet(guestIn, SCOUT_DESK_PALETTE.outline), ground);
    assert.equal(feet(guestOut, SCOUT_DESK_PALETTE.outline), ground);
    const midRun = paintVisit(awake, { role: "depart", side: "left", elapsedMs: 250 });
    assert.ok(feet(midRun, SCOUT_PALETTE.outline) < ground);
  }).catch(assert.fail);

  describe("the guest carries the hosting look", () => {
    const full = scoutLook({ connected: true, repliesToday: 8, stats: { level: 7, streak: 9 } });
    const plain = scoutLook({ connected: true, repliesToday: 0, stats: { level: 7, streak: 0 } });
    const greeting = SCOUT_VISIT_GREET_AT_MS + 200;
    const cellsOf = (fills: Fill[], color: string, cell: number) =>
      fills.filter((fill) => fill.color === color && fill.w === cell && fill.h === cell).length;

    it("draws the guest scarf only when the look has one", () => {
      assert.ok(full.scarf && !plain.scarf);
      assert.ok(cellsOf(host(greeting, full, "right", GUEST_TONES), GUEST_TONES.scarf, full.cell) > 0);
      assert.equal(cellsOf(host(greeting, plain, "right", GUEST_TONES), GUEST_TONES.scarf, plain.cell), 0);
    }).catch(assert.fail);

    it("draws the big bulb in the guest palette only when the look has one", () => {
      const bulbCells = (look: ScoutLook) => {
        const fills = host(greeting, look, "right", { ...GUEST_TONES, bulbOn: "#0b0b0b", outline: "#0b0b0b" });
        return fills.filter((fill) => fill.color === "#0b0b0b" && fill.w === look.cell && fill.h === look.cell).length;
      };
      const small = scoutLook({ connected: true, repliesToday: 8, stats: { level: 7, streak: 3 } });
      assert.ok(full.bigBulb && !small.bigBulb);
      assert.ok(bulbCells(full) > bulbCells(small));
    }).catch(assert.fail);

    it("lights the guest bulb when the look glows and leaves it off when it does not", () => {
      const lit = host(greeting, full, "right", GUEST_TONES);
      const dark = host(greeting, plain, "right", GUEST_TONES);
      assert.ok(lit.some((fill) => fill.color === GUEST_TONES.bulbOn && fill.w === full.cell));
      assert.ok(!dark.some((fill) => fill.color === GUEST_TONES.bulbOn));
      assert.ok(dark.some((fill) => fill.color === GUEST_TONES.bulbOff && fill.w === plain.cell));
    }).catch(assert.fail);

    it("gives the guest its own aura centred on it next to the resident's", () => {
      const withAura = host(greeting, full);
      const size = SCOUT_SPRITE_SIZE * full.cell;
      const spot = Math.round(160 + full.cell);
      const lift = Math.round(Math.sin(((greeting - SCOUT_VISIT_GREET_AT_MS) / 1_500) * 2 * Math.PI) * 3) * full.cell;
      const centre = { x: spot + size / 2, y: 132 - SCOUT_GROUND_INSET - size - lift + size / 2 };
      assert.equal(withAura.auras.length, 2);
      assert.ok(withAura.auras.some((aura) => aura.x === centre.x && aura.y === centre.y), JSON.stringify(withAura.auras));
      assert.equal(host(greeting, plain).auras.length, 0);
    }).catch(assert.fail);

    it("sparkles around the guest in the guest palette", () => {
      const sparks = (fills: Fill[], color: string, cell: number) =>
        fills.filter((fill) => fill.color === color && fill.w === cell * 3 && fill.h === cell).length;
      assert.ok(full.sparkles > 0);
      const tones = { ...GUEST_TONES, cheek: "#0c0c0c", bulbOn: "#0d0d0d" };
      const found = [greeting, greeting + 130, greeting + 260, greeting + 390].some((elapsedMs) => {
        const fills = paintVisit(full, { role: "host", guest: tones, entry: "right", elapsedMs }, 320, elapsedMs);
        return sparks(fills, tones.cheek, full.cell) + sparks(fills, tones.bulbOn, full.cell) > 0;
      });
      assert.ok(found);
      const none = paintVisit(plain, { role: "host", guest: tones, entry: "right", elapsedMs: greeting }, 320, greeting);
      assert.equal(sparks(none, tones.cheek, plain.cell) + sparks(none, tones.bulbOn, plain.cell), 0);
    }).catch(assert.fail);
  }).catch(assert.fail);

  describe("one character across the seam", () => {
    const big = scoutLook({ connected: true, repliesToday: 0, stats: { level: 7, streak: 0 } });
    const deskWidth = 900;
    const panelWidth = 375;
    const bigSize = SCOUT_SPRITE_SIZE * big.cell;
    const gap = SCOUT_VISIT_GAP_PX;
    const step = 8;
    const GUEST_TONES_LIST = [GUEST_TONES.outline, GUEST_TONES.body, GUEST_TONES.highlight, GUEST_TONES.ink, GUEST_TONES.cheek, GUEST_TONES.scarf, GUEST_TONES.bulbOn, GUEST_TONES.bulbOff];

    const edges = (fills: Fill[], tones: ScoutPalette) => {
      const colors = [tones.outline, tones.body, tones.highlight, tones.ink, tones.cheek, tones.scarf, tones.bulbOn, tones.bulbOff];
      const parts = fills.filter((fill) => colors.includes(fill.color) && fill.w === big.cell && fill.h === big.cell);
      if (parts.length === 0) return null;
      return { left: Math.min(...parts.map((fill) => fill.x)), right: Math.max(...parts.map((fill) => fill.x + fill.w)) };
    };

    const trace = (side: "left" | "right") => {
      const entry = side === "left" ? "right" : "left";
      const toShared = (x: number) => (side === "left" ? panelWidth + gap + x : x - deskWidth - gap);
      const frames: {
        ms: number;
        desk: { left: number; right: number } | null;
        guest: { left: number; right: number } | null;
        deskSeen: boolean;
        guestSeen: boolean;
      }[] = [];
      for (let ms = 0; ms <= SCOUT_VISIT_TOTAL_MS; ms += step) {
        const desk = paintVisit(big, { role: "depart", side, elapsedMs: ms }, deskWidth, 0, DESK_TONES);
        const panel = paintVisit(big, { role: "host", guest: GUEST_TONES, entry, elapsedMs: ms }, panelWidth, 0, SCOUT_PALETTE);
        const deskEdges = edges(desk, DESK_TONES);
        const guestEdges = edges(panel, GUEST_TONES);
        frames.push({
          ms,
          desk: deskEdges && { left: toShared(deskEdges.left), right: toShared(deskEdges.right) },
          guest: guestEdges,
          deskSeen: desk.some((fill) => fill.w === big.cell && fill.x < deskWidth && fill.x + fill.w > 0 && fill.color !== DESK_TONES.ground),
          guestSeen: panel.some((fill) => fill.color !== SCOUT_PALETTE.ground && GUEST_TONES_LIST.includes(fill.color) && fill.w === big.cell && fill.x < panelWidth && fill.x + fill.w > 0),
        });
      }
      return frames;
    };

    it("puts the desk sprite and the guest on the same spot of the path while both exist", () => {
      for (const side of ["left", "right"] as const) {
        const frames = trace(side);
        const shown = frames.filter((frame) => frame.deskSeen && frame.guestSeen);
        assert.ok(shown.length >= 8, `${side} ${shown.length}`);
        for (const frame of shown) {
          assert.ok(frame.desk && frame.guest, `${side} ${frame.ms}`);
          assert.ok(Math.abs(frame.desk.left - frame.guest.left) <= 2, `${side} ${frame.ms} ${frame.desk.left} ${frame.guest.left}`);
        }
      }
    }).catch(assert.fail);

    it("is visible on a surface at every moment of both crossings and on both at once", () => {
      for (const side of ["left", "right"] as const) {
        const frames = trace(side);
        const crossings = [
          [SCOUT_VISIT_OUT_AT_MS - 80, SCOUT_VISIT_IN_AT_MS + bigSize / SCOUT_VISIT_SPEED],
          [SCOUT_VISIT_PANEL_OUT_AT_MS - 80, SCOUT_VISIT_BACK_AT_MS + bigSize / SCOUT_VISIT_SPEED],
        ];
        for (const [from, to] of crossings) {
          const window = frames.filter((frame) => frame.ms >= from && frame.ms <= to);
          assert.ok(window.every((frame) => frame.deskSeen || frame.guestSeen), `${side} ${from}`);
          const both = window.filter((frame) => frame.deskSeen && frame.guestSeen);
          assert.ok(both.length >= 4, `${side} ${from} ${both.length}`);
        }
      }
    }).catch(assert.fail);

    it("moves one steady step per frame in one direction through both crossings on either side", () => {
      for (const side of ["left", "right"] as const) {
        const frames = trace(side);
        const sign = side === "left" ? -1 : 1;
        const crossings = [
          { from: SCOUT_VISIT_OUT_AT_MS - 40, to: SCOUT_VISIT_IN_AT_MS + 250, forward: sign },
          { from: SCOUT_VISIT_PANEL_OUT_AT_MS - 40, to: SCOUT_VISIT_BACK_AT_MS + 250, forward: -sign },
        ];
        for (const { from, to, forward } of crossings) {
          const lead = frames
            .filter((frame) => frame.ms >= from && frame.ms <= to)
            .map((frame) => {
              const parts = [frame.desk, frame.guest].filter((part): part is { left: number; right: number } => part !== null);
              return forward < 0 ? Math.min(...parts.map((part) => part.left)) : Math.max(...parts.map((part) => part.right));
            });
          for (let i = 1; i < lead.length; i += 1) {
            const delta = (lead[i] ?? 0) - (lead[i - 1] ?? 0);
            assert.ok(delta * forward > 0, `${side} ${from} direction ${delta}`);
            assert.ok(Math.abs(Math.abs(delta) - SCOUT_VISIT_SPEED * step) <= 1.6, `${side} ${from} step ${delta}`);
          }
        }
      }
    }).catch(assert.fail);
  }).catch(assert.fail);
}).catch(assert.fail);

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
    const onStage = (fills: Fill[]) => visibleSpan(fills, SCOUT_PALETTE.body, 320);
    assert.equal(onStage(runFrame(2_000 + SCOUT_VISIT_OUT_AT_MS + 500)), null);
    assert.equal(onStage(runFrame(2_000 + SCOUT_VISIT_BACK_AT_MS - 100)), null);
    const entering = onStage(runFrame(2_000 + SCOUT_VISIT_BACK_AT_MS + 30));
    const settling = onStage(runFrame(2_000 + SCOUT_VISIT_BACK_AT_MS + 600));
    assert.ok(entering && settling);
    assert.equal(entering.left, 0);
    assert.ok(settling.right > entering.right);
    const homeFills = runFrame(2_000 + SCOUT_VISIT_TOTAL_MS + 10).filter((fill) => fill.color === SCOUT_PALETTE.body);
    const center = (fills: Fill[]) => (Math.min(...fills.map((fill) => fill.x)) + Math.max(...fills.map((fill) => fill.x + fill.w))) / 2;
    const patrolCenter = center(paintVisit(awake, null, 320, 2_000 + SCOUT_VISIT_TOTAL_MS + 10).filter((fill) => fill.color === SCOUT_PALETTE.body));
    assert.equal(center(homeFills), patrolCenter);
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

await describe("scoutFrameDue", () => {
  it("paints every frame while something moves and throttles idle and napping Scouts", () => {
    assert.equal(scoutFrameDue({ timeMs: 10, lastPaintMs: null, busy: false, awake: true }), true);
    assert.equal(scoutFrameDue({ timeMs: 16, lastPaintMs: 0, busy: true, awake: true }), true);
    assert.equal(scoutFrameDue({ timeMs: 16, lastPaintMs: 0, busy: false, awake: true }), false);
    assert.equal(scoutFrameDue({ timeMs: SCOUT_IDLE_FRAME_MS, lastPaintMs: 0, busy: false, awake: true }), true);
    assert.equal(scoutFrameDue({ timeMs: SCOUT_IDLE_FRAME_MS, lastPaintMs: 0, busy: false, awake: false }), false);
    assert.equal(scoutFrameDue({ timeMs: SCOUT_NAP_FRAME_MS, lastPaintMs: 0, busy: false, awake: false }), true);
  }).catch(assert.fail);

  it("skips painting an idle stage between throttled frames", () => {
    const { canvas, runFrame } = fakeStage(320);
    const stage = startScoutStage(canvas, { look: scoutLook({ connected: true, repliesToday: 0, stats: null }) });
    assert.ok(runFrame(1_000).length > 0);
    assert.equal(runFrame(1_016).length, 0);
    assert.ok(runFrame(1_000 + SCOUT_IDLE_FRAME_MS).length > 0);
    stage.cheer();
    assert.ok(runFrame(1_000 + SCOUT_IDLE_FRAME_MS + 16).length > 0);
    assert.ok(runFrame(1_000 + SCOUT_IDLE_FRAME_MS + 32).length > 0);
    stage.stop();
  }).catch(assert.fail);
});
