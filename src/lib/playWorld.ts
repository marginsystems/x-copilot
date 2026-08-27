/** DOM-free apron camera. Three.js stays in PlayWorld.tsx. */

export const PLAY_ORBIT = {
  yaw0: 0.72,
  pitch0: 0.28,
  radius0: 16,
  radiusMin: 8,
  radiusMax: 32,
  pitchMin: 0.06,
  pitchMax: 1.2,
  autoDelaySec: 10,
  autoSpeed: 0.1,
  lookY: 1.35,
} as const;

export type PlayOrbit = {
  yaw: number;
  pitch: number;
  radius: number;
};

export function defaultOrbit(): PlayOrbit {
  return {
    yaw: PLAY_ORBIT.yaw0,
    pitch: PLAY_ORBIT.pitch0,
    radius: PLAY_ORBIT.radius0,
  };
}

export function clampOrbit(orbit: PlayOrbit): PlayOrbit {
  return {
    yaw: Number.isFinite(orbit.yaw) ? orbit.yaw : PLAY_ORBIT.yaw0,
    pitch: Math.min(
      PLAY_ORBIT.pitchMax,
      Math.max(PLAY_ORBIT.pitchMin, Number.isFinite(orbit.pitch) ? orbit.pitch : PLAY_ORBIT.pitch0),
    ),
    radius: Math.min(
      PLAY_ORBIT.radiusMax,
      Math.max(PLAY_ORBIT.radiusMin, Number.isFinite(orbit.radius) ? orbit.radius : PLAY_ORBIT.radius0),
    ),
  };
}

/** Drag: x yaws around the plane, y pitches. */
export function dragOrbit(orbit: PlayOrbit, dx: number, dy: number, sens = 0.008): PlayOrbit {
  return clampOrbit({
    yaw: orbit.yaw + dx * sens,
    pitch: orbit.pitch + dy * sens,
    radius: orbit.radius,
  });
}

/** Pinch scale > 1 dollies in. */
export function pinchOrbit(orbit: PlayOrbit, scale: number): PlayOrbit {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return clampOrbit({
    yaw: orbit.yaw,
    pitch: orbit.pitch,
    radius: orbit.radius / s,
  });
}

export function autoOrbit(
  orbit: PlayOrbit,
  dt: number,
  idleSec: number,
  reducedMotion = false,
): PlayOrbit {
  if (reducedMotion || dt <= 0 || idleSec < PLAY_ORBIT.autoDelaySec) return orbit;
  return clampOrbit({
    yaw: orbit.yaw + PLAY_ORBIT.autoSpeed * dt,
    pitch: orbit.pitch,
    radius: orbit.radius,
  });
}

export function cameraFromOrbit(
  orbit: PlayOrbit,
  lookY = PLAY_ORBIT.lookY,
): { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } {
  const o = clampOrbit(orbit);
  const cp = Math.cos(o.pitch);
  return {
    x: Math.sin(o.yaw) * cp * o.radius,
    y: Math.sin(o.pitch) * o.radius,
    z: Math.cos(o.yaw) * cp * o.radius,
    lookX: 0,
    lookY,
    lookZ: 0,
  };
}

export type PlayHudMission = {
  id: string;
  label: string;
  progress: number;
  target: number;
  claimed: boolean;
};

export function playToastFromMissions(
  prev: readonly PlayHudMission[] | null,
  next: readonly PlayHudMission[],
): string | null {
  if (!prev) return null;
  for (const row of next) {
    const before = prev.find((p) => p.id === row.id);
    if (!before) continue;
    if (!before.claimed && row.claimed) {
      return `${row.label} claimed`;
    }
    if (row.progress > before.progress) {
      return `${row.label} ${row.progress}/${row.target}`;
    }
  }
  return null;
}
