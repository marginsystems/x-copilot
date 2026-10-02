import { describe, expect, it } from "vitest";
import {
  ATTENTION_MS,
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
