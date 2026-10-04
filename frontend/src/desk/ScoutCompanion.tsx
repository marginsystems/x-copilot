import { useEffect, useMemo, useRef, useState } from "react";
import type { CoachingState } from "../../../shared/src/coaching";
import { repliesTodayCount, scoutLook } from "../../../shared/src/scoutCompanion";
import {
  SCOUT_CANVAS_LABEL,
  SCOUT_PALETTE,
  startScoutStage,
  type ScoutPalette,
  type ScoutStage,
} from "../../../shared/src/scoutCompanionStage";
import type { GamificationStats } from "../lib/gamification";

const DESK_COMPANION_STAGE_HEIGHT = 116;
const DAY_ROLLOVER_CHECK_MS = 60_000;

type ScoutCompanionProps = {
  coaching?: CoachingState | null;
  gamification?: GamificationStats | null;
};

function deskPalette(node: Element): ScoutPalette {
  const tokens = getComputedStyle(node);
  const token = (name: string, fallback: string) => tokens.getPropertyValue(name).trim() || fallback;
  return {
    ...SCOUT_PALETTE,
    ground: token("--border", SCOUT_PALETTE.ground),
    bulbOff: token("--border-strong", SCOUT_PALETTE.bulbOff),
    sleep: token("--muted", SCOUT_PALETTE.sleep),
  };
}

function useThemeName(): string {
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute("data-theme") ?? "");
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.getAttribute("data-theme") ?? ""));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function ScoutCompanion({ coaching, gamification }: ScoutCompanionProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<ScoutStage | null>(null);
  const stageThemeRef = useRef("");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const theme = useThemeName();

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), DAY_ROLLOVER_CHECK_MS);
    return () => window.clearInterval(id);
  }, []);

  const serverCount = coaching?.repliesToday;
  const replyAt = coaching?.replyAt;
  const level = gamification?.level;
  const streak = gamification?.currentStreak;
  const look = useMemo(
    () =>
      scoutLook({
        connected: true,
        repliesToday: repliesTodayCount(serverCount, replyAt ?? [], nowMs),
        stats: level === undefined || streak === undefined ? null : { level, streak },
      }),
    [serverCount, replyAt, level, streak, nowMs],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (stageRef.current && stageThemeRef.current === theme) {
      stageRef.current.show(look);
      return;
    }
    stageRef.current?.stop();
    stageRef.current = startScoutStage(canvas, {
      look,
      height: DESK_COMPANION_STAGE_HEIGHT,
      palette: deskPalette(canvas),
    });
    stageThemeRef.current = theme;
  }, [look, theme]);

  useEffect(
    () => () => {
      stageRef.current?.stop();
      stageRef.current = null;
    },
    [],
  );

  return (
    <section className="desk-companion" aria-label="Scout companion">
      <canvas
        ref={canvasRef}
        className="desk-companion-stage"
        style={{ height: DESK_COMPANION_STAGE_HEIGHT }}
        role="img"
        aria-label={SCOUT_CANVAS_LABEL}
      />
      <p className="desk-companion-line">{look.line}</p>
    </section>
  );
}
