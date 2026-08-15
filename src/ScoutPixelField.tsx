import { useEffect, useRef, useState } from "react";
import { PLANE_MASK, liveRatio, seedLife, stepLife } from "./lib/pixelField";

const CELL = 5;
const GAP = 3;
const STEP = CELL + GAP;

const IDLE_TICK_MS = 900;
const BUSY_TICK_MS = 340;
const IDLE_SEED = 0.05;
const BUSY_SEED = 0.12;
const IDLE_FLOOR = 0.025;
const BUSY_FLOOR = 0.07;
const PLANE_CROSS_MS = 9000;

const PLANE_ROWS = PLANE_MASK.length;
const PLANE_COLS = PLANE_MASK[0].length;

type Props = {
  searching: boolean;
};

/**
 * Decorative Conway-life "flight field" filling the leftover stretch of the
 * Agenda pane. Idle: sparse and slow. Searching: denser, with a paper-plane
 * silhouette drifting through and stirring the cells. Renders a single static
 * frame when the user prefers reduced motion.
 */
export function ScoutPixelField({ searching }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchingRef = useRef(searching);
  const burstRef = useRef(false);
  const [reducedMotion, setReducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (searching && !searchingRef.current) burstRef.current = true;
    searchingRef.current = searching;
  }, [searching]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cols = 0;
    let rows = 0;
    let grid: Uint8Array = new Uint8Array(0);
    let scratch: Uint8Array = new Uint8Array(0);
    let energy = new Float32Array(0);
    let width = 0;
    let height = 0;
    let dpr = 1;
    let rafId = 0;
    let lastFrame = 0;
    let lastTick = 0;
    let planeStart = 0;
    let planeRow = 0;
    let accent = "#7eb8dc";
    let accentDim = "#3d5f73";

    function readColors() {
      const styles = getComputedStyle(canvas as HTMLCanvasElement);
      accent = styles.getPropertyValue("--accent").trim() || accent;
      accentDim = styles.getPropertyValue("--accent-dim").trim() || accentDim;
    }

    function resize() {
      const w = Math.floor(wrap!.clientWidth);
      const h = Math.floor(wrap!.clientHeight);
      if (w <= 0 || h <= 0) {
        width = 0;
        height = 0;
        return;
      }
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = w;
      height = h;
      canvas!.width = w * dpr;
      canvas!.height = h * dpr;
      const nextCols = Math.max(1, Math.floor((w + GAP) / STEP));
      const nextRows = Math.max(1, Math.floor((h + GAP) / STEP));
      if (nextCols === cols && nextRows === rows) return;
      cols = nextCols;
      rows = nextRows;
      grid = new Uint8Array(cols * rows);
      scratch = new Uint8Array(cols * rows);
      energy = new Float32Array(cols * rows);
      seedLife(grid, searchingRef.current ? BUSY_SEED : IDLE_SEED);
      resetPlane(performance.now());
    }

    function resetPlane(now: number) {
      planeStart = now;
      planeRow = Math.floor(Math.random() * Math.max(1, rows - PLANE_ROWS));
    }

    function tickLife(now: number) {
      const busy = searchingRef.current;
      if (now - lastTick < (busy ? BUSY_TICK_MS : IDLE_TICK_MS)) return;
      lastTick = now;
      readColors();
      scratch = stepLife(grid, cols, rows, scratch);
      const tmp = grid;
      grid = scratch;
      scratch = tmp;
      if (burstRef.current) {
        burstRef.current = false;
        seedLife(grid, BUSY_SEED);
      }
      if (liveRatio(grid) < (busy ? BUSY_FLOOR : IDLE_FLOOR)) {
        seedLife(grid, busy ? BUSY_SEED : IDLE_SEED);
      }
    }

    function drawPlane(now: number) {
      const progress = (now - planeStart) / PLANE_CROSS_MS;
      if (progress >= 1) {
        resetPlane(now);
        return;
      }
      const travel = cols + PLANE_COLS * 2;
      const headCol = Math.floor(progress * travel) - PLANE_COLS;
      const drift = Math.sin(progress * Math.PI * 2) * 1.5;
      const baseRow = Math.round(planeRow + drift);

      ctx!.fillStyle = accentDim;
      ctx!.globalAlpha = 0.55;
      for (let t = 2; t <= 8; t += 2) {
        const c = headCol - t;
        if (c < 0 || c >= cols || baseRow + 2 < 0 || baseRow + 2 >= rows) continue;
        ctx!.globalAlpha = 0.5 - t * 0.05;
        ctx!.fillRect(c * STEP, (baseRow + 2) * STEP, CELL, CELL);
      }

      ctx!.fillStyle = accent;
      ctx!.globalAlpha = 0.9;
      for (let r = 0; r < PLANE_ROWS; r++) {
        for (let c = 0; c < PLANE_COLS; c++) {
          if (PLANE_MASK[r][c] !== "#") continue;
          const col = headCol + c;
          const row = baseRow + r;
          if (col < 0 || row < 0 || col >= cols || row >= rows) continue;
          ctx!.fillRect(col * STEP, row * STEP, CELL, CELL);
        }
      }

      // Stir the field in the plane's wake so it leaves living activity behind.
      const wakeCol = headCol - 1;
      if (wakeCol >= 0 && wakeCol < cols) {
        for (let r = 0; r < PLANE_ROWS; r++) {
          const row = baseRow + r;
          if (row < 0 || row >= rows) continue;
          if (Math.random() < 0.25) grid[row * cols + wakeCol] = 1;
        }
      }
      ctx!.globalAlpha = 1;
    }

    function drawCells(dt: number) {
      const busy = searchingRef.current;
      const baseAlpha = busy ? 0.5 : 0.32;
      const fade = Math.min(1, dt / 220);
      ctx!.fillStyle = accent;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col;
          const target = grid[i] ? 1 : 0;
          energy[i] += (target - energy[i]) * fade;
          const e = energy[i];
          if (e < 0.04) continue;
          ctx!.globalAlpha = e * baseAlpha * (0.8 + ((row + col) % 3) * 0.1);
          ctx!.fillRect(col * STEP, row * STEP, CELL, CELL);
        }
      }
      ctx!.globalAlpha = 1;
    }

    function frame(now: number) {
      if (width <= 0 || height <= 0) return;
      rafId = requestAnimationFrame(frame);
      const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
      lastFrame = now;
      tickLife(now);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      drawCells(dt);
      if (searchingRef.current) drawPlane(now);
    }

    function drawStatic() {
      if (width <= 0 || height <= 0) return;
      readColors();
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.clearRect(0, 0, width, height);
      ctx!.fillStyle = accent;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          if (!grid[row * cols + col]) continue;
          ctx!.globalAlpha = 0.3;
          ctx!.fillRect(col * STEP, row * STEP, CELL, CELL);
        }
      }
      ctx!.globalAlpha = 1;
    }

    resize();
    const ro = new ResizeObserver(() => {
      const paused = width <= 0 || height <= 0;
      resize();
      if (width <= 0 || height <= 0) return;
      if (reducedMotion) {
        drawStatic();
        return;
      }
      if (paused) rafId = requestAnimationFrame(frame);
    });
    ro.observe(wrap);

    const mo = new MutationObserver(() => {
      readColors();
      if (reducedMotion) drawStatic();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    if (reducedMotion) {
      drawStatic();
    } else {
      rafId = requestAnimationFrame(frame);
    }

    return () => {
      ro.disconnect();
      mo.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [reducedMotion]);

  return (
    <div ref={wrapRef} className="scout-field" aria-hidden="true">
      <canvas ref={canvasRef} className="scout-field-canvas" />
    </div>
  );
}
