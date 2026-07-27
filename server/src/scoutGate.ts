/**
 * In-memory Scout concurrency + cooldown gate (one run at a time, 15s between finishes).
 */

export const SCOUT_COOLDOWN_MS = 15_000;

type GateReject = {
  ok: false;
  status: 429;
  error: "scout_busy" | "scout_cooldown";
  message: string;
};

type GateAllow = { ok: true };

let active = false;
let lastFinishedAt = 0;

export function resetScoutGateForTests(opts?: {
  active?: boolean;
  lastFinishedAt?: number;
}): void {
  active = opts?.active ?? false;
  lastFinishedAt = opts?.lastFinishedAt ?? 0;
}

export function tryBeginScout(nowMs: number = Date.now()): GateAllow | GateReject {
  if (active) {
    return {
      ok: false,
      status: 429,
      error: "scout_busy",
      message: "A Scout run is already in progress. Wait for it to finish.",
    };
  }
  const since = nowMs - lastFinishedAt;
  if (lastFinishedAt > 0 && since < SCOUT_COOLDOWN_MS) {
    const waitSec = Math.ceil((SCOUT_COOLDOWN_MS - since) / 1000);
    return {
      ok: false,
      status: 429,
      error: "scout_cooldown",
      message: `Wait ${waitSec}s before searching again.`,
    };
  }
  active = true;
  return { ok: true };
}

export function endScout(nowMs: number = Date.now()): void {
  active = false;
  lastFinishedAt = nowMs;
}
