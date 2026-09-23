import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatReplyPaceClock,
  nextReplyPaceUntil,
  parseReplyPaceUntil,
  replyPaceSeedIso,
  seedReplyPaceUntil,
  REPLY_PACE_MS,
  replyPaceLocked,
  replyPaceRemainingMs,
} from "./replyPace.ts";

import {
  armReplyPace,
  seedReplyPaceFromReplyAt,
  armReplyPaceOverlay,
  clearReplyPaceOverlay,
  clearReplyPace,
  readReplyPaceOverlay,
} from "../desk/replyPaceStore.ts";

describe("reply pace overlay storage", () => {
  it("persists until expiry or Bypass clears it", (t) => {
    const stored = new Map<string, string>();
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    t.after(() => {
      if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
    });
    assert.equal(readReplyPaceOverlay(), false);
    const now = Date.parse("2026-09-15T12:00:20.000Z");
    assert.equal(seedReplyPaceFromReplyAt("2026-09-15T12:00:00.000Z", now),
      Date.parse("2026-09-15T12:01:00.000Z"));
    assert.equal(readReplyPaceOverlay(), false, "Detect seeds data without an overlay");
    armReplyPace(now);
    assert.equal(readReplyPaceOverlay(), false, "A running clock does not arm the overlay");
    for (const markCleared of [false, true]) {
      armReplyPaceOverlay();
      assert.equal(readReplyPaceOverlay(), true);
      clearReplyPace(markCleared);
      assert.equal(readReplyPaceOverlay(), false);
    }
  }).catch(assert.fail);

  it("clears only the overlay marker", (t) => {
    const stored = new Map<string, string>();
    const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
    const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
    t.after(() => {
      if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
      else Reflect.deleteProperty(globalThis, "sessionStorage");
      if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
      else Reflect.deleteProperty(globalThis, "window");
    });
    stored.set("x-copilot-reply-pace-until", "1700000060000");
    armReplyPaceOverlay();
    clearReplyPaceOverlay();
    assert.equal(readReplyPaceOverlay(), false);
    assert.equal(stored.get("x-copilot-reply-pace-until"), "1700000060000");
  }).catch(assert.fail);

});

describe("replyPace", () => {
  it("arms 60 seconds from now", () => {
    assert.equal(REPLY_PACE_MS, 60_000);
    assert.equal(nextReplyPaceUntil(1_000), 61_000);
  }).catch(assert.fail);

  it("reads a finite until or returns null", () => {
    assert.equal(parseReplyPaceUntil("1700000060000"), 1_700_000_060_000);
    assert.equal(parseReplyPaceUntil(null), null);
    assert.equal(parseReplyPaceUntil(""), null);
    assert.equal(parseReplyPaceUntil("nope"), null);
    assert.equal(parseReplyPaceUntil("0"), null);
  }).catch(assert.fail);

  it("locks only while remaining time is positive", () => {
    assert.equal(replyPaceRemainingMs(1_060, 1_000), 60);
    assert.equal(replyPaceRemainingMs(1_000, 1_000), 0);
    assert.equal(replyPaceRemainingMs(900, 1_000), 0);
    assert.equal(replyPaceRemainingMs(null, 1_000), 0);
    assert.equal(replyPaceLocked(1_060, 1_000), true);
    assert.equal(replyPaceLocked(1_000, 1_000), false);
    assert.equal(replyPaceLocked(null, 1_000), false);
  }).catch(assert.fail);

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
        storedUntil: Date.parse("2026-09-05T12:00:40.000Z"),
        cleared: false,
        replyAtIso: "2026-09-05T12:00:00.000Z",
        nowMs: Date.parse("2026-09-05T12:00:20.000Z"),
      }),
      Date.parse("2026-09-05T12:00:40.000Z"),
    );
  }).catch(assert.fail);

  it("re-seeds from a recent replyAt when the stored until has expired", () => {
    assert.equal(
      seedReplyPaceUntil({
        storedUntil: Date.parse("2026-09-05T12:00:30.000Z"),
        cleared: false,
        replyAtIso: "2026-09-05T12:01:00.000Z",
        nowMs: Date.parse("2026-09-05T12:01:20.000Z"),
      }),
      Date.parse("2026-09-05T12:02:00.000Z"),
    );
  }).catch(assert.fail);

  it("seeds from the newest detected reply and ignores other activity", () => {
    const replyAtIso = "2026-09-05T12:00:00.000Z";
    assert.equal(
      replyPaceSeedIso({
        replyAtIso: undefined,
        ownActivity: {
          kind: "reply",
          postedAt: "2026-09-05T12:00:20.000Z",
        },
      }),
      "2026-09-05T12:00:20.000Z",
    );
    assert.equal(
      replyPaceSeedIso({
        replyAtIso,
        ownActivity: {
          kind: "reply",
          postedAt: "2026-09-05T12:00:20.000Z",
        },
      }),
      "2026-09-05T12:00:20.000Z",
    );
    assert.equal(
      replyPaceSeedIso({
        replyAtIso,
        ownActivity: {
          kind: "reply",
          postedAt: "2026-09-05T11:59:40.000Z",
        },
      }),
      replyAtIso,
    );
    assert.equal(
      replyPaceSeedIso({
        replyAtIso,
        ownActivity: {
          kind: "original",
          postedAt: "2026-09-05T12:00:30.000Z",
        },
      }),
      replyAtIso,
    );
  }).catch(assert.fail);

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
  }).catch(assert.fail);

  it("prints a m:ss clock", () => {
    assert.equal(formatReplyPaceClock(60_000), "1:00");
    assert.equal(formatReplyPaceClock(59_001), "1:00");
    assert.equal(formatReplyPaceClock(1_000), "0:01");
    assert.equal(formatReplyPaceClock(1), "0:01");
    assert.equal(formatReplyPaceClock(0), "0:00");
  }).catch(assert.fail);
});
