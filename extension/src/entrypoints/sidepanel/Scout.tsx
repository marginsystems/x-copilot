import { useEffect, useRef } from "react";
import { SCOUT_SPRITE_SIZE, scoutSprite, type ScoutLook } from "../../lib/scout";

const STAGE_HEIGHT = 132;
const GROUND_INSET = 10;
const BLINK_EVERY_MS = 3_200;
const BLINK_MS = 140;
const BOB_MS = 520;
const PATROL_MS = 9_000;
const HOP_MS = 900;
const FALLBACK_WIDTH = 280;

const COLORS = {
  outline: "#3d5f73",
  body: "#7eb8dc",
  highlight: "#b9dcf0",
  ink: "#161310",
  cheek: "#d9a441",
  scarf: "#d9a441",
  bulbOff: "#4d453c",
  bulbOn: "#7dba8a",
  ground: "#3a332c",
  sleep: "#a89f94",
};

type Motion = { hopStartMs: number | null };

function cellColor(code: string, bulb: string): string | null {
  if (code === "o" || code === "f") return COLORS.outline;
  if (code === "b") return COLORS.body;
  if (code === "h") return COLORS.highlight;
  if (code === "e" || code === "m") return COLORS.ink;
  if (code === "c") return COLORS.cheek;
  if (code === "s") return COLORS.scarf;
  if (code === "a") return bulb;
  return null;
}

function hopLift(motion: Motion, timeMs: number, cell: number): number {
  if (motion.hopStartMs === null) return 0;
  const progress = (timeMs - motion.hopStartMs) / HOP_MS;
  if (progress >= 1) {
    motion.hopStartMs = null;
    return 0;
  }
  return Math.round(Math.abs(Math.sin(progress * Math.PI * 2)) * 4) * cell;
}

function drawScout(
  ctx: CanvasRenderingContext2D,
  width: number,
  look: ScoutLook,
  motion: Motion,
  timeMs: number,
  still: boolean,
): void {
  const cell = look.cell;
  const size = SCOUT_SPRITE_SIZE * cell;
  const ground = STAGE_HEIGHT - GROUND_INSET;
  const roam = Math.max(0, (width - size) / 2 - cell * 4);
  const swing = look.awake && !still ? Math.sin((timeMs / PATROL_MS) * Math.PI * 2) : 0;
  const facingLeft = look.awake && !still && Math.cos((timeMs / PATROL_MS) * Math.PI * 2) < 0;
  const left = Math.round((width - size) / 2 + swing * roam);
  const bob = still ? 0 : Math.floor(timeMs / BOB_MS) % 2 === 0 ? 0 : look.awake ? cell : 0;
  const top = ground - size - bob - hopLift(motion, timeMs, cell);
  const pulse = still ? 1 : 0.75 + 0.25 * Math.sin(timeMs / 380);

  ctx.clearRect(0, 0, width, STAGE_HEIGHT);

  if (look.glow > 0) {
    const centerX = left + size / 2;
    const centerY = top + size / 2;
    const reach = Math.min(centerY, size * (0.8 + look.glow * 0.5));
    const aura = ctx.createRadialGradient(centerX, centerY, size * 0.2, centerX, centerY, reach);
    aura.addColorStop(0, `rgba(125, 186, 138, ${(0.38 * look.glow * pulse).toFixed(3)})`);
    aura.addColorStop(1, "rgba(125, 186, 138, 0)");
    ctx.fillStyle = aura;
    ctx.fillRect(0, 0, width, ground);
  }

  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, ground, width, 1);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(left + cell * 3, ground + 1, size - cell * 6, 2);

  const bulb = look.glow > 0 && pulse > 0.7 ? COLORS.bulbOn : look.glow > 0 ? COLORS.outline : COLORS.bulbOff;
  const blink = !still && timeMs % BLINK_EVERY_MS < BLINK_MS;
  const rows = scoutSprite({ awake: look.awake, blink, scarf: look.scarf, bigBulb: look.bigBulb });
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x += 1) {
      const color = cellColor(row.charAt(facingLeft ? row.length - 1 - x : x), bulb);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(left + x * cell, top + y * cell, cell, cell);
    }
  });

  for (let index = 0; index < look.sparkles; index += 1) {
    const phase = still ? 1 : Math.sin(timeMs / 260 + index * 1.7);
    if (phase < 0.2) continue;
    const angle = index * 2.4 + (still ? 0 : timeMs / 5_000);
    const reach = size * (0.62 + (index % 3) * 0.1);
    const x = Math.round(left + size / 2 + Math.cos(angle) * reach);
    const y = Math.round(top + size / 2 + Math.sin(angle) * reach * 0.7);
    if (y > ground - cell) continue;
    ctx.fillStyle = index % 2 === 0 ? COLORS.bulbOn : COLORS.cheek;
    ctx.fillRect(x - cell, y, cell * 3, cell);
    ctx.fillRect(x, y - cell, cell, cell * 3);
  }

  if (!look.awake) {
    const drift = still ? 0 : Math.floor(timeMs / 600) % 3;
    ctx.fillStyle = COLORS.sleep;
    const zx = left + size + cell;
    const zy = top - drift * cell;
    ctx.fillRect(zx, zy, cell * 3, cell);
    ctx.fillRect(zx + cell, zy + cell, cell, cell);
    ctx.fillRect(zx, zy + cell * 2, cell * 3, cell);
  }
}

export function Scout({ look }: { look: ScoutLook }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lookRef = useRef(look);
  const motionRef = useRef<Motion>({ hopStartMs: null });
  const repliesRef = useRef(look.repliesToday);
  const hopDueRef = useRef(false);
  lookRef.current = look;

  if (look.repliesToday > repliesRef.current) hopDueRef.current = true;
  repliesRef.current = look.repliesToday;

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let width = FALLBACK_WIDTH;
    let frame = 0;

    const fit = () => {
      const ratio = window.devicePixelRatio || 1;
      width = canvas.clientWidth || FALLBACK_WIDTH;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(STAGE_HEIGHT * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.imageSmoothingEnabled = false;
    };
    const paint = (timeMs: number) => {
      if (hopDueRef.current) {
        hopDueRef.current = false;
        motionRef.current.hopStartMs = timeMs;
      }
      drawScout(ctx, width, lookRef.current, motionRef.current, timeMs, still);
      if (!still) frame = window.requestAnimationFrame(paint);
    };
    const refit = () => {
      fit();
      if (still) paint(0);
    };

    fit();
    frame = window.requestAnimationFrame(paint);
    window.addEventListener("resize", refit);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", refit);
    };
  }, [look.awake, look.cell, look.glow, look.scarf, look.bigBulb, look.sparkles]);

  return (
    <section className="scout" aria-label="Scout">
      <canvas ref={canvasRef} className="scout-stage" role="img" aria-label="Scout, your X Copilot companion" />
      <p className="scout-line">{look.line}</p>
      {look.facts.length > 0 ? (
        <dl className="scout-facts">
          {look.facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
