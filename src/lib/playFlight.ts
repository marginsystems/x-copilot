/** DOM-free arcade flight. Never reads XP or writes a ledger. */

export const FLIGHT = {
  startX: 0,
  startY: 0,
  startZ: 2.2,
  startYaw: Math.PI,
  liftSpeed: 8.5,
  maxSpeed: 24,
  thrust: 16,
  drag: 5.4,
  brake: 20,
  climb: 10,
  sink: 12,
  maxAlt: 26,
  bankRate: 1.8,
  turnFromBank: 1.15,
  rollReturn: 2.4,
  pitchMax: 0.35,
} as const;

export type FlightInput = {
  throttle: boolean;
  bank: number;
};

export type FlightState = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  airborne: boolean;
};

export type FlightGate = {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
};

export const CIRCUIT_GATES: readonly FlightGate[] = [
  { id: "g1", x: 0, y: 7, z: -16, r: 3.6 },
  { id: "g2", x: -10, y: 10, z: -34, r: 3.8 },
  { id: "g3", x: 0, y: 9, z: -52, r: 3.8 },
  { id: "g4", x: 10, y: 8, z: -28, r: 3.6 },
];

export function parkedFlight(): FlightState {
  return {
    x: FLIGHT.startX,
    y: FLIGHT.startY,
    z: FLIGHT.startZ,
    yaw: FLIGHT.startYaw,
    pitch: 0,
    roll: 0,
    speed: 0,
    airborne: false,
  };
}

export function clampBank(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < -1) return -1;
  if (n > 1) return 1;
  return n;
}

export function stepFlight(
  state: FlightState,
  input: FlightInput,
  dt: number,
): FlightState {
  if (dt <= 0) return state;
  const bank = clampBank(input.bank);
  let { x, y, z, yaw, pitch, roll, speed, airborne } = state;

  if (input.throttle) speed += FLIGHT.thrust * dt;
  else if (!airborne) speed -= FLIGHT.brake * dt;
  else speed -= FLIGHT.drag * dt;
  speed = Math.max(0, Math.min(FLIGHT.maxSpeed, speed));

  if (!airborne && speed >= FLIGHT.liftSpeed) airborne = true;
  if (airborne) {
    roll += (bank * FLIGHT.bankRate - roll * FLIGHT.rollReturn) * dt;
    yaw += roll * FLIGHT.turnFromBank * dt;
    const climb = (speed - FLIGHT.liftSpeed) / FLIGHT.liftSpeed;
    const wantY = climb > 0 ? FLIGHT.climb * climb : FLIGHT.sink * climb;
    y += wantY * dt;
    y = Math.max(0, Math.min(FLIGHT.maxAlt, y));
    pitch = Math.max(-FLIGHT.pitchMax, Math.min(FLIGHT.pitchMax, climb * 0.22));
    if (y <= 0 && speed < FLIGHT.liftSpeed) {
      airborne = false;
      y = 0;
      pitch = 0;
      roll *= 0.4;
    }
  } else {
    roll *= Math.max(0, 1 - 6 * dt);
    pitch = 0;
    y = 0;
  }

  const heading = airborne || input.throttle || speed > 0.4 ? yaw : state.yaw;
  x += Math.sin(heading) * speed * dt;
  z += Math.cos(heading) * speed * dt;

  return { x, y, z, yaw: heading, pitch, roll, speed, airborne };
}

export function hitGate(state: FlightState, gate: FlightGate): boolean {
  const dx = state.x - gate.x;
  const dy = state.y - gate.y;
  const dz = state.z - gate.z;
  return dx * dx + dy * dy + dz * dz <= gate.r * gate.r;
}

export function nextGateIndex(cleared: readonly boolean[]): number {
  const i = cleared.findIndex((c) => !c);
  return i < 0 ? cleared.length : i;
}

export function chaseCamera(
  state: FlightState,
  dist = 12,
  height = 4.2,
): { x: number; y: number; z: number; lookX: number; lookY: number; lookZ: number } {
  return {
    x: state.x - Math.sin(state.yaw) * dist,
    y: state.y + height,
    z: state.z - Math.cos(state.yaw) * dist,
    lookX: state.x,
    lookY: state.y + 1.2,
    lookZ: state.z,
  };
}
