import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReplyPaceClock,
  nextReplyPaceUntil,
  parseReplyPaceUntil,
  seedReplyPaceUntil,
  REPLY_PACE_MS,
  replyPaceHoldActive,
  replyPaceLocked,
  replyPaceRemainingMs,
} from "./replyPace.ts";

describe("replyPace", () => {
  it("arms 60 seconds from now", () => {
    assert.equal(REPLY_PACE_MS, 60_000);
    assert.equal(nextReplyPaceUntil(1_000), 61_000);
  });

  it("reads a finite until or returns null", () => {
    assert.equal(parseReplyPaceUntil("1700000060000"), 1_700_000_060_000);
    assert.equal(parseReplyPaceUntil(null), null);
    assert.equal(parseReplyPaceUntil(""), null);
    assert.equal(parseReplyPaceUntil("nope"), null);
    assert.equal(parseReplyPaceUntil("0"), null);
  });

  it("locks only while remaining time is positive", () => {
    assert.equal(replyPaceRemainingMs(1_060, 1_000), 60);
    assert.equal(replyPaceRemainingMs(1_000, 1_000), 0);
    assert.equal(replyPaceRemainingMs(900, 1_000), 0);
    assert.equal(replyPaceRemainingMs(null, 1_000), 0);
    assert.equal(replyPaceLocked(1_060, 1_000), true);
    assert.equal(replyPaceLocked(1_000, 1_000), false);
    assert.equal(replyPaceLocked(null, 1_000), false);
  });

  it("does not hold after the clock runs out", () => {
    assert.equal(replyPaceHoldActive(1_100, 1_000), true);
    assert.equal(replyPaceHoldActive(1_000, 1_000), false);
    assert.equal(replyPaceHoldActive(900, 1_000), false);
    assert.equal(replyPaceHoldActive(null, 1_000), false);
  });

  it("seeds from a recent replyAt and keeps an existing until", () => {
    assert.equal(
      seedReplyPaceUntil({
        storedUntil: null,
        cleared: false,
        replyAtIso: "2026-09-05T12:00:00.000Z",
        nowMs: Date.parse("2026-09-05T12:00:20.000Z"),
      }),
      Date.parse("2026-09-05T12:01:00.000Z"),
    );
    assert.equal(
      seedReplyPaceUntil({
        storedUntil: 99,
        cleared: false,
        replyAtIso: "2026-09-05T12:00:00.000Z",
        nowMs: Date.parse("2026-09-05T12:00:20.000Z"),
      }),
      99,
    );
  });

  it("does not seed after Bypass or when the minute has elapsed", () => {
    assert.equal(
      seedReplyPaceUntil({
        storedUntil: null,
        cleared: true,
        replyAtIso: "2026-09-05T12:00:00.000Z",
        nowMs: Date.parse("2026-09-05T12:00:20.000Z"),
      }),
      null,
    );
    assert.equal(
      seedReplyPaceUntil({
        storedUntil: null,
        cleared: false,
        replyAtIso: "2026-09-05T12:00:00.000Z",
        nowMs: Date.parse("2026-09-05T12:01:00.000Z"),
      }),
      null,
    );
  });

  it("prints a m:ss clock", () => {
    assert.equal(formatReplyPaceClock(60_000), "1:00");
    assert.equal(formatReplyPaceClock(59_001), "1:00");
    assert.equal(formatReplyPaceClock(1_000), "0:01");
    assert.equal(formatReplyPaceClock(1), "0:01");
    assert.equal(formatReplyPaceClock(0), "0:00");
  });
});
