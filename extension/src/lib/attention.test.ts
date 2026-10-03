import { describe, expect, it } from "vitest";
import {
  ATTENTION_MS,
  READY_LINGER_MS,
  chipPhase,
  readySince,
  IDLE_CLOCK,
  attentionLabel,
  attentionReady,
  statusIdFromPath,
  tickAttention,
  type AttentionClock,
  type AttentionSignals,
} from "./attention";

const attending = (statusId: string, nowMs: number): AttentionSignals => ({
  statusId,
  nowMs,
  visible: true,
  focused: true,
  postInView: true,
});

function run(clock: AttentionClock, ticks: AttentionSignals[]): AttentionClock {
  return ticks.reduce(tickAttention, clock);
}

describe("statusIdFromPath", () => {
  it("reads the status id from post and photo paths", () => {
    expect(statusIdFromPath("/dana/status/123")).toBe("123");
    expect(statusIdFromPath("/dana/status/123/photo/1")).toBe("123");
  });

  it("ignores timelines and malformed ids", () => {
    expect(statusIdFromPath("/home")).toBeNull();
    expect(statusIdFromPath("/dana")).toBeNull();
    expect(statusIdFromPath("/dana/status/abc")).toBeNull();
  });
});

describe("tickAttention", () => {
  it("is ready after 10 s of attended time on one post", () => {
    const ticks = Array.from({ length: 41 }, (_, i) => attending("1", i * 250));
    const clock = run(IDLE_CLOCK, ticks);
    expect(clock.attendedMs).toBe(ATTENTION_MS);
    expect(attentionReady(clock)).toBe(true);
    expect(attentionLabel(clock)).toBe("Ready");
  });

  it("counts down in whole seconds", () => {
    const clock = run(IDLE_CLOCK, [attending("1", 0), attending("1", 250), attending("1", 3_250)]);
    expect(clock.attendedMs).toBe(1_250);
    expect(attentionLabel(clock)).toBe("Reading · 9s");
  });

  it("pauses while the tab is hidden, unfocused, or the post is off screen", () => {
    const start = run(IDLE_CLOCK, [attending("1", 0), attending("1", 1_000)]);
    const paused = run(start, [
      { ...attending("1", 2_000), visible: false },
      { ...attending("1", 3_000), focused: false },
      { ...attending("1", 4_000), postInView: false },
    ]);
    expect(paused.attendedMs).toBe(1_000);
  });

  it("caps one step so a sleeping tab cannot jump the clock", () => {
    const clock = run(IDLE_CLOCK, [attending("1", 0), attending("1", 60_000)]);
    expect(clock.attendedMs).toBe(1_000);
  });

  it("starts over on a new post and stays idle off post pages", () => {
    const first = run(IDLE_CLOCK, [attending("1", 0), attending("1", 1_000)]);
    const next = tickAttention(first, attending("2", 1_500));
    expect(next).toEqual({ statusId: "2", attendedMs: 0, lastTickAt: 1_500 });
    const home = tickAttention(next, { ...attending("2", 2_000), statusId: null });
    expect(home.attendedMs).toBe(0);
    expect(tickAttention(home, { ...attending("x", 3_000), statusId: null }).attendedMs).toBe(0);
  });
});

describe("chip phase", () => {
  const counting: AttentionClock = { statusId: "1", attendedMs: 4_000, lastTickAt: 0 };
  const ready: AttentionClock = { statusId: "1", attendedMs: ATTENTION_MS, lastTickAt: 0 };

  it("counts down until the post has been read", () => {
    expect(readySince(counting, null, 5_000)).toBeNull();
    expect(chipPhase(counting, null, 5_000)).toBe("counting");
  });

  it("shows Ready briefly, then goes away", () => {
    const since = readySince(ready, null, 10_000);
    expect(since).toBe(10_000);
    expect(readySince(ready, since, 10_800)).toBe(10_000);
    expect(chipPhase(ready, since, 10_800)).toBe("ready");
    expect(chipPhase(ready, since, 10_000 + READY_LINGER_MS)).toBe("gone");
  });

  it("starts over when a new post resets the clock", () => {
    expect(readySince(counting, 10_000, 20_000)).toBeNull();
  });
});
