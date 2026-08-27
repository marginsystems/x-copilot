import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PLAY_TO_DESK_LABEL } from "./lib/play";
import { playToastFromMissions, type PlayVec2 } from "./lib/playWorld";

const PlayWorld = lazy(() =>
  import("./PlayWorld").then((m) => ({ default: m.PlayWorld })),
);
import type { CoachingState } from "./lib/coaching";
import type { GamificationStats } from "./lib/gamification";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export function PlayPage(props: {
  onBack: () => void;
  userId: string | null;
  coaching: CoachingState | null;
  gamification: GamificationStats;
}) {
  const reducedMotion = useReducedMotion();
  const inputRef = useRef<PlayVec2>({ x: 0, z: 0 });
  const orbitRef = useRef(0.35);
  const keysRef = useRef(new Set<string>());
  const [toast, setToast] = useState<string | null>(null);
  const prevMissions = useRef(props.coaching?.missions ?? null);

  const lit =
    Boolean(props.coaching?.dayUtc) &&
    props.gamification.lastMarkUtcDay === props.coaching?.dayUtc;

  useEffect(() => {
    const next = props.coaching?.missions ?? [];
    const line = playToastFromMissions(prevMissions.current, next);
    prevMissions.current = next;
    if (!line) return;
    setToast(line);
    const id = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(id);
  }, [props.coaching]);

  useEffect(() => {
    const sync = () => {
      const keys = keysRef.current;
      let x = 0;
      let z = 0;
      if (keys.has("a") || keys.has("arrowleft")) x -= 1;
      if (keys.has("d") || keys.has("arrowright")) x += 1;
      if (keys.has("w") || keys.has("arrowup")) z += 1;
      if (keys.has("s") || keys.has("arrowdown")) z -= 1;
      if (!stickActive.current) inputRef.current = { x, z };
    };
    const down = (e: KeyboardEvent) => {
      keysRef.current.add(e.key.toLowerCase());
      sync();
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
      sync();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  const stickActive = useRef(false);
  const stickOrigin = useRef({ x: 0, y: 0 });

  function onStickStart(e: React.PointerEvent<HTMLDivElement>) {
    stickActive.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const box = e.currentTarget.getBoundingClientRect();
    stickOrigin.current = {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
    };
    onStickMove(e);
  }
  function onStickMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!stickActive.current) return;
    const dx = (e.clientX - stickOrigin.current.x) / 42;
    const dy = (e.clientY - stickOrigin.current.y) / 42;
    inputRef.current = {
      x: Math.max(-1, Math.min(1, dx)),
      z: Math.max(-1, Math.min(1, -dy)),
    };
  }
  function onStickEnd() {
    stickActive.current = false;
    inputRef.current = { x: 0, z: 0 };
  }

  const lookActive = useRef(false);
  const lookLast = useRef(0);
  function onLookStart(e: React.PointerEvent<HTMLDivElement>) {
    lookActive.current = true;
    lookLast.current = e.clientX;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function onLookMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!lookActive.current) return;
    orbitRef.current += (e.clientX - lookLast.current) * 0.008;
    lookLast.current = e.clientX;
  }
  function onLookEnd() {
    lookActive.current = false;
  }

  const missions = props.coaching?.missions ?? [];

  return (
    <section className="play-world" data-user={props.userId ?? ""}>
      <Suspense fallback={<div className="play-world-stage" />}>
        <PlayWorld
          lit={lit}
          reducedMotion={reducedMotion}
          inputRef={inputRef}
          orbitRef={orbitRef}
        />
      </Suspense>
      <div
        className="play-look"
        onPointerDown={onLookStart}
        onPointerMove={onLookMove}
        onPointerUp={onLookEnd}
        onPointerCancel={onLookEnd}
      />
      <header className="play-hud-top">
        <p className="play-hud-name">
          Hangar · LV {props.gamification.level} · Streak {props.gamification.currentStreak}
        </p>
        <button type="button" className="ghost play-hud-back" onClick={props.onBack}>
          Desk
        </button>
      </header>
      {toast ? (
        <p className="play-toast" role="status">
          {toast}
        </p>
      ) : null}
      <div className="play-hud-missions">
        {missions.map((m) => (
          <span key={m.id} className={m.claimed ? "is-done" : undefined}>
            {m.label} {m.progress}/{m.target}
          </span>
        ))}
      </div>
      <div
        className="play-stick"
        onPointerDown={onStickStart}
        onPointerMove={onStickMove}
        onPointerUp={onStickEnd}
        onPointerCancel={onStickEnd}
      >
        <span>Move</span>
      </div>
      <button type="button" className="play-desk-fab" onClick={props.onBack}>
        {PLAY_TO_DESK_LABEL}
      </button>
      <p className="play-credit">Yard models: Kenney Platformer Kit (CC0)</p>
    </section>
  );
}
