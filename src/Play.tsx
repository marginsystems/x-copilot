import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { PLAY_TO_DESK_LABEL } from "./lib/play";
import { parkedFlight, type FlightInput, type FlightState } from "./lib/playFlight";
import {
  defaultOrbit,
  dragOrbit,
  pinchOrbit,
  playToastFromMissions,
  type PlayOrbit,
} from "./lib/playWorld";
import type { CoachingState } from "./lib/coaching";
import type { GamificationStats } from "./lib/gamification";

const PlayWorld = lazy(() =>
  import("./PlayWorld").then((m) => ({ default: m.PlayWorld })),
);

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
  const orbitRef = useRef<PlayOrbit>(defaultOrbit());
  const orbitingRef = useRef(false);
  const flightRef = useRef<FlightState>(parkedFlight());
  const inputRef = useRef<FlightInput>({ throttle: false, bank: 0 });
  const keyThrottleRef = useRef(false);
  const pillThrottleRef = useRef(false);
  const heldBankRef = useRef(new Set<string>());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch0 = useRef(0);
  const [holding, setHolding] = useState(false);
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
    const syncThrottle = () => {
      inputRef.current.throttle = keyThrottleRef.current || pillThrottleRef.current;
      setHolding(keyThrottleRef.current || pillThrottleRef.current);
    };
    const applyKeyboardBank = () => {
      const held = heldBankRef.current;
      const left = held.has("a") || held.has("arrowleft");
      const right = held.has("d") || held.has("arrowright");
      inputRef.current.bank = left ? -1 : right ? 1 : 0;
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "w" || k === "arrowup") {
        e.preventDefault();
        keyThrottleRef.current = true;
        syncThrottle();
        return;
      }
      if (k === "a" || k === "arrowleft" || k === "d" || k === "arrowright") {
        e.preventDefault();
        heldBankRef.current.add(k);
        applyKeyboardBank();
      }
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "w" || k === "arrowup") {
        e.preventDefault();
        keyThrottleRef.current = false;
        inputRef.current.dragBank = 0;
        syncThrottle();
        return;
      }
      if (k === "a" || k === "arrowleft" || k === "d" || k === "arrowright") {
        e.preventDefault();
        heldBankRef.current.delete(k);
        applyKeyboardBank();
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    const reset = () => {
      keyThrottleRef.current = false;
      pillThrottleRef.current = false;
      heldBankRef.current.clear();
      inputRef.current.throttle = false;
      inputRef.current.bank = 0;
      inputRef.current.dragBank = 0;
      setHolding(false);
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") reset();
    };
    window.addEventListener("blur", reset);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", reset);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  function onLookStart(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    orbitingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch0.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
  }
  function onLookMove(e: React.PointerEvent<HTMLDivElement>) {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0.current > 8 && dist > 8) {
        orbitRef.current = pinchOrbit(orbitRef.current, dist / pinch0.current);
        pinch0.current = dist;
      }
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (flightRef.current.airborne && inputRef.current.throttle) {
      inputRef.current.dragBank = Math.max(-1, Math.min(1, dx * 0.04));
      return;
    }
    orbitRef.current = dragOrbit(orbitRef.current, dx, dy);
  }
  function onLookEnd(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    inputRef.current.dragBank = 0;
    if (pointers.current.size === 0) orbitingRef.current = false;
  }

  const missions = props.coaching?.missions ?? [];

  return (
    <section className="play-world" data-user={props.userId ?? ""}>
      <Suspense fallback={<div className="play-world-stage" />}>
        <PlayWorld
          lit={lit}
          reducedMotion={reducedMotion}
          orbitRef={orbitRef}
          orbitingRef={orbitingRef}
          flightRef={flightRef}
          inputRef={inputRef}
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
          Apron · LV {props.gamification.level} · Streak {props.gamification.currentStreak}
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
      <p
        className={holding ? "play-hold is-hold" : "play-hold"}
        onPointerDown={(e) => {
          pillThrottleRef.current = true;
          inputRef.current.throttle = keyThrottleRef.current || pillThrottleRef.current;
          setHolding(inputRef.current.throttle);
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={() => {
          pillThrottleRef.current = false;
          inputRef.current.throttle = keyThrottleRef.current || pillThrottleRef.current;
          inputRef.current.dragBank = 0;
          setHolding(inputRef.current.throttle);
        }}
        onPointerCancel={() => {
          pillThrottleRef.current = false;
          inputRef.current.throttle = keyThrottleRef.current || pillThrottleRef.current;
          inputRef.current.dragBank = 0;
          setHolding(inputRef.current.throttle);
        }}
      >
        {holding ? "Throttle" : "Hold to take off"}
      </p>
      <button type="button" className="play-desk-fab" onClick={props.onBack}>
        {PLAY_TO_DESK_LABEL}
      </button>
      <p className="play-credit">Cesium Air sample · Apache 2.0</p>
    </section>
  );
}
