export const ATTENTION_MS = 10_000;
export const ATTENTION_MAX_STEP_MS = 1_000;

export type AttentionClock = {
  statusId: string | null;
  attendedMs: number;
  lastTickAt: number | null;
};

export type AttentionSignals = {
  statusId: string | null;
  nowMs: number;
  visible: boolean;
  focused: boolean;
  postInView: boolean;
};

export const IDLE_CLOCK: AttentionClock = { statusId: null, attendedMs: 0, lastTickAt: null };

export function statusIdFromPath(pathname: string): string | null {
  const match = /^\/[^/]+\/status\/(\d+)(?:\/|$)/.exec(pathname);
  return match?.[1] ?? null;
}

export function tickAttention(clock: AttentionClock, signals: AttentionSignals): AttentionClock {
  if (signals.statusId !== clock.statusId) {
    return { statusId: signals.statusId, attendedMs: 0, lastTickAt: signals.nowMs };
  }
  if (!signals.statusId) return { ...clock, lastTickAt: signals.nowMs };
  const attending = signals.visible && signals.focused && signals.postInView;
  const step =
    attending && clock.lastTickAt !== null
      ? Math.min(Math.max(0, signals.nowMs - clock.lastTickAt), ATTENTION_MAX_STEP_MS)
      : 0;
  return {
    statusId: clock.statusId,
    attendedMs: Math.min(ATTENTION_MS, clock.attendedMs + step),
    lastTickAt: signals.nowMs,
  };
}

export function attentionReady(clock: AttentionClock): boolean {
  return clock.attendedMs >= ATTENTION_MS;
}

export function attentionSecondsLeft(clock: AttentionClock): number {
  return Math.max(0, Math.ceil((ATTENTION_MS - clock.attendedMs) / 1_000));
}

export function attentionLabel(clock: AttentionClock): string {
  if (attentionReady(clock)) return "Ready";
  return `Reading · ${attentionSecondsLeft(clock)}s`;
}

export const READY_LINGER_MS = 1_500;

export type ChipPhase = "counting" | "ready" | "gone";

export function readySince(clock: AttentionClock, previous: number | null, nowMs: number): number | null {
  if (!attentionReady(clock)) return null;
  return previous ?? nowMs;
}

export function chipPhase(clock: AttentionClock, since: number | null, nowMs: number): ChipPhase {
  if (!attentionReady(clock) || since === null) return "counting";
  return nowMs - since < READY_LINGER_MS ? "ready" : "gone";
}
