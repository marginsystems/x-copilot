import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MARK_DETECT_POLL_INTERVAL_MS,
  MARK_DETECT_TIMEOUT_MS,
  markDetectCheckingNote,
  markDetectMissNote,
  markDetectTimeoutNote,
  markDetectWaitingNote,
  nextMarkDetectWaitMs,
  shouldContinueMarkDetectPoll,
  waitWithCountdown,
} from "./markDetectPoll.ts";

describe("markDetectPoll notes", () => {
  it("formats checking / waiting / timeout copy", () => {
    assert.equal(markDetectCheckingNote(1), "Checking… (1)");
    assert.equal(markDetectWaitingNote(5, 2), "Waiting 5s… (next check 2)");
    assert.equal(markDetectWaitingNote(0, 3), "Waiting 1s… (next check 3)");
    assert.match(markDetectTimeoutNote(), /Timed out/);
    assert.match(markDetectTimeoutNote(), /mark again/);
    assert.match(markDetectMissNote("ambiguous"), /Multiple replies/);
    assert.match(markDetectMissNote("none"), /Couldn't find/);
    assert.doesNotMatch(markDetectTimeoutNote(), /paste/i);
    assert.doesNotMatch(markDetectMissNote("none"), /paste/i);
  });
});

describe("shouldContinueMarkDetectPoll", () => {
  it("stops on found, ambiguous, hard error, or timeout", () => {
    assert.equal(
      shouldContinueMarkDetectPoll({ found: true, elapsedMs: 0 }),
      false,
    );
    assert.equal(
      shouldContinueMarkDetectPoll({
        found: false,
        reason: "ambiguous",
        elapsedMs: 0,
      }),
      false,
    );
    assert.equal(
      shouldContinueMarkDetectPoll({
        found: false,
        reason: "error",
        elapsedMs: 0,
      }),
      false,
    );
    assert.equal(
      shouldContinueMarkDetectPoll({
        found: false,
        reason: "none",
        elapsedMs: MARK_DETECT_TIMEOUT_MS,
      }),
      false,
    );
  });

  it("continues on soft misses before timeout", () => {
    assert.equal(
      shouldContinueMarkDetectPoll({
        found: false,
        reason: "none",
        elapsedMs: 0,
      }),
      true,
    );
    assert.equal(
      shouldContinueMarkDetectPoll({
        found: false,
        reason: "search_failed",
        elapsedMs: 10_000,
      }),
      true,
    );
  });
});

describe("nextMarkDetectWaitMs", () => {
  it("uses poll interval until near the deadline", () => {
    assert.equal(nextMarkDetectWaitMs({ elapsedMs: 0 }), MARK_DETECT_POLL_INTERVAL_MS);
    assert.equal(
      nextMarkDetectWaitMs({ elapsedMs: 28_000 }),
      2_000,
    );
    assert.equal(
      nextMarkDetectWaitMs({ elapsedMs: MARK_DETECT_TIMEOUT_MS }),
      0,
    );
  });
});

describe("waitWithCountdown", () => {
  it("ticks seconds remaining and completes", async () => {
    const ticks: number[] = [];
    let t = 0;
    const result = await waitWithCountdown(2500, {
      now: () => t,
      onTick: (s) => ticks.push(s),
      sleep: async (ms) => {
        t += ms;
        return "ok";
      },
    });
    assert.equal(result, "ok");
    assert.deepEqual(ticks, [3, 2, 1]);
  });

  it("aborts during wait", async () => {
    const ac = new AbortController();
    let t = 0;
    const result = await waitWithCountdown(5000, {
      signal: ac.signal,
      now: () => t,
      onTick: () => {
        ac.abort();
      },
      sleep: async () => "aborted",
    });
    assert.equal(result, "aborted");
  });
});
