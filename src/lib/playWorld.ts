/** DOM-free hangar-yard movement. Three.js stays in PlayWorld.tsx. */

export const PLAY_YARD = 7.4;
export const PLAY_SPEED = 4.4;

export type PlayVec2 = { x: number; z: number };

export function clampUnit(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < -1) return -1;
  if (n > 1) return 1;
  return n;
}

export function stepMove(
  pos: PlayVec2,
  input: PlayVec2,
  dt: number,
  yaw = 0,
  speed = PLAY_SPEED,
): { pos: PlayVec2; yaw: number; moving: boolean } {
  const ix = clampUnit(input.x);
  const iz = clampUnit(input.z);
  const mag = Math.hypot(ix, iz);
  if (mag < 0.08 || dt <= 0) return { pos, yaw, moving: false };
  const nx = ix / mag;
  const nz = iz / mag;
  let x = pos.x + nx * speed * dt;
  let z = pos.z + nz * speed * dt;
  x = Math.max(-PLAY_YARD, Math.min(PLAY_YARD, x));
  z = Math.max(-PLAY_YARD, Math.min(PLAY_YARD, z));
  return {
    pos: { x, z },
    yaw: Math.atan2(nx, nz),
    moving: true,
  };
}

/** Stick x=right, z=forward (W / stick up). Rotated into the camera's ground plane. */
export function aimMove(input: PlayVec2, orbit: number): PlayVec2 {
  const fx = -Math.sin(orbit);
  const fz = -Math.cos(orbit);
  const rx = Math.cos(orbit);
  const rz = -Math.sin(orbit);
  return {
    x: rx * clampUnit(input.x) + fx * clampUnit(input.z),
    z: rz * clampUnit(input.x) + fz * clampUnit(input.z),
  };
}

export function cameraFollow(
  pos: PlayVec2,
  orbit = 0,
): { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } {
  const dist = 8;
  const height = 5;
  const a = orbit;
  return {
    x: pos.x + Math.sin(a) * dist,
    y: height,
    z: pos.z + Math.cos(a) * dist,
    lookX: pos.x,
    lookY: 1.15,
    lookZ: pos.z,
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
