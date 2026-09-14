/**
 * In-memory Scout concurrency + cooldown gate, keyed by platform user:
 * one run at a time per user, 15s between that user's finishes. Another
 * user's run never blocks this one.
 */

export const SCOUT_COOLDOWN_MS = 15_000;

type GateReject = {
  ok: false;
  status: 429;
  error: "scout_busy" | "scout_cooldown";
  message: string;
};

type GateAllow = { ok: true };

type ScoutFlightStage =
  | "planning"
  | "searching"
  | "filtering"
  | "triaging"
  | "partial"
  | "done"
  | "error";

type GateState = {
  active: boolean;
  lastFinishedAt: number;
  stage: ScoutFlightStage | null;
};

const FLIGHT_STAGES = new Set<string>([
  "planning",
  "searching",
  "filtering",
  "triaging",
  "partial",
  "done",
  "error",
]);

const gates = new Map<string, GateState>();

function gateFor(userId: string): GateState {
  let state = gates.get(userId);
  if (!state) {
    state = { active: false, lastFinishedAt: 0, stage: null };
    gates.set(userId, state);
  }
  return state;
}

function gateKey(userId: string): string {
  const key = userId.trim();
  if (!key) throw new Error("userId is required");
  return key;
}

export function resetScoutGateForTests(opts?: {
  userId?: string;
  active?: boolean;
  lastFinishedAt?: number;
}): void {
  gates.clear();
  if (opts?.userId) {
    gates.set(gateKey(opts.userId), {
      active: opts.active ?? false,
      lastFinishedAt: opts.lastFinishedAt ?? 0,
      stage: opts.active ? "planning" : null,
    });
  }
}

export function tryBeginScout(
  userId: string,
  nowMs: number = Date.now(),
): GateAllow | GateReject {
  const gate = gateFor(gateKey(userId));
  if (gate.active) {
    return {
      ok: false,
      status: 429,
      error: "scout_busy",
      message: "A Scout run is already in progress. Wait for it to finish.",
    };
  }
  const since = nowMs - gate.lastFinishedAt;
  if (gate.lastFinishedAt > 0 && since < SCOUT_COOLDOWN_MS) {
    const waitSec = Math.ceil((SCOUT_COOLDOWN_MS - since) / 1000);
    return {
      ok: false,
      status: 429,
      error: "scout_cooldown",
      message: `Wait ${waitSec}s before searching again.`,
    };
  }
  gate.active = true;
  gate.stage = "planning";
  return { ok: true };
}

export function noteScoutStage(userId: string, stage: string): void {
  const gate = gateFor(gateKey(userId));
  if (!gate.active || !FLIGHT_STAGES.has(stage)) return;
  gate.stage = stage as ScoutFlightStage;
}

export function peekScoutFlight(userId: string): {
  active: boolean;
  stage: ScoutFlightStage | null;
} {
  const key = userId.trim();
  if (!key) return { active: false, stage: null };
  const gate = gates.get(key);
  if (!gate) return { active: false, stage: null };
  return {
    active: gate.active,
    stage: gate.active ? gate.stage : null,
  };
}

export function endScout(userId: string, nowMs: number = Date.now()): void {
  const gate = gateFor(gateKey(userId));
  gate.active = false;
  gate.stage = null;
  gate.lastFinishedAt = nowMs;
}
