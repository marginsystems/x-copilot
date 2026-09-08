import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearForYouWait,
  forYouWaitDetected,
  hasDetectedForYouPost,
  openForYouWait,
  parseForYouWait,
  readForYouWait,
  settleForYouWait,
  snapshotForYouWait,
  writeForYouWait,
} from "./forYouTask.ts";

const coaching = {
  postsToday: 2,
  postAt: ["2026-09-05T12:00:00.000Z"],
  replyAt: ["2026-09-05T11:00:00.000Z"],
};

const ENTERED = Date.parse("2026-09-05T13:00:00.000Z");

describe("For You wait identity", () => {
  it("opens with an owner, entry time, baseline, and no completion", () => {
    const wait = openForYouWait({ owner: "u1", coaching, now: ENTERED });
    assert.deepEqual(wait, {
      held: true,
      kind: "for_you",
      owner: "u1",
      enteredAt: "2026-09-05T13:00:00.000Z",
      snapshot: snapshotForYouWait(coaching),
      detectedAt: null,
    });
  });

  it("uses the entry time as the explicit baseline when coaching is late", () => {
    const wait = openForYouWait({ owner: "u1", coaching: null, now: ENTERED });
    assert.equal(wait.snapshot, null);
    assert.equal(forYouWaitDetected(wait, null), false);
    assert.equal(forYouWaitDetected(wait, coaching), false);
    assert.equal(
      forYouWaitDetected(wait, {
        ...coaching,
        replyAt: ["2026-09-05T13:00:01.000Z"],
      }),
      true,
    );
  });

  it("late coaching becomes the baseline only when it post-dates nothing", () => {
    const wait = openForYouWait({ owner: "u1", coaching: null, now: ENTERED });
    const settled = settleForYouWait(wait, coaching, ENTERED + 12_000);
    assert.deepEqual(settled.snapshot, snapshotForYouWait(coaching));
    assert.equal(settled.detectedAt, null);
    assert.equal(forYouWaitDetected(settled, coaching), false);
  });

  it("late coaching that carries a post after entry marks detection instead of absorbing it", () => {
    const wait = openForYouWait({ owner: "u1", coaching: null, now: ENTERED });
    const late = {
      postsToday: 3,
      postAt: ["2026-09-05T13:00:30.000Z"],
      replyAt: coaching.replyAt,
    };
    const settled = settleForYouWait(wait, late, ENTERED + 40_000);
    assert.equal(settled.detectedAt, "2026-09-05T13:00:40.000Z");
    assert.equal(forYouWaitDetected(settled, late), true);
  });

  it("detection is monotonic once marked", () => {
    const wait = openForYouWait({ owner: "u1", coaching, now: ENTERED });
    const hit = settleForYouWait(
      wait,
      { ...coaching, replyAt: ["2026-09-05T13:05:00.000Z"] },
      ENTERED + 300_000,
    );
    assert.notEqual(hit.detectedAt, null);
    const older = settleForYouWait(hit, coaching, ENTERED + 400_000);
    assert.equal(older, hit);
    assert.equal(forYouWaitDetected(older, coaching), true);
  });

  it("returns the same object when a payload changes nothing", () => {
    const wait = openForYouWait({ owner: "u1", coaching, now: ENTERED });
    assert.equal(settleForYouWait(wait, coaching), wait);
    assert.equal(settleForYouWait(wait, null), wait);
  });
});

describe("For You wait detection", () => {
  it("detects a newer post after a UTC day rollover", () => {
    assert.equal(
      hasDetectedForYouPost(
        {
          postsToday: 2,
          postAt: "2026-09-04T12:00:00.000Z",
          replyAt: null,
        },
        { postsToday: 1, postAt: ["2026-09-05T08:00:00.000Z"] },
      ),
      true,
    );
  });

  it("does not detect only a UTC day rollover", () => {
    assert.equal(
      hasDetectedForYouPost(
        {
          postsToday: 2,
          postAt: "2026-09-04T23:00:00.000Z",
          replyAt: null,
        },
        { postsToday: 0, postAt: ["2026-09-04T23:00:00.000Z"] },
      ),
      false,
    );
  });

  it("detects a newer reply without a new original", () => {
    assert.equal(
      hasDetectedForYouPost(
        {
          postsToday: 2,
          postAt: "2026-09-05T10:00:00.000Z",
          replyAt: "2026-09-05T09:00:00.000Z",
        },
        {
          postsToday: 2,
          postAt: ["2026-09-05T10:00:00.000Z"],
          replyAt: ["2026-09-05T11:00:00.000Z"],
        },
      ),
      true,
    );
  });

  it("does not detect an unchanged baseline and handles missing coaching", () => {
    const snapshot = snapshotForYouWait(coaching)!;
    assert.equal(hasDetectedForYouPost(snapshot, coaching), false);
    assert.equal(hasDetectedForYouPost(snapshot, null), false);
  });

  it("detects activity against a conservative late-coaching baseline", () => {
    assert.equal(
      hasDetectedForYouPost(
        { postsToday: 0, postAt: null, replyAt: null },
        { postsToday: 1, postAt: ["2026-09-05T12:00:00.000Z"] },
      ),
      true,
    );
  });
});

describe("For You wait storage", () => {
  function withSessionStorage(run: () => void) {
    const values = new Map<string, string>();
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    });
    try {
      run();
    } finally {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
  }

  it("round-trips a held wait scoped to its owner", () => {
    withSessionStorage(() => {
      const wait = openForYouWait({ owner: "u1", coaching, now: ENTERED });
      writeForYouWait(wait);
      assert.deepEqual(readForYouWait("u1"), wait);
      assert.equal(readForYouWait("u2"), null);
      clearForYouWait("u1");
      assert.equal(readForYouWait("u1"), null);
    });
  });

  it("ignores the legacy unscoped shape and foreign owners", () => {
    assert.equal(
      parseForYouWait(
        JSON.stringify({ held: true, snapshot: snapshotForYouWait(coaching) }),
        "u1",
      ),
      null,
    );
    const wait = openForYouWait({ owner: "u2", coaching, now: ENTERED });
    assert.equal(parseForYouWait(JSON.stringify(wait), "u1"), null);
    assert.deepEqual(parseForYouWait(JSON.stringify(wait), "u2"), wait);
    assert.equal(parseForYouWait("not json", "u1"), null);
  });
});
