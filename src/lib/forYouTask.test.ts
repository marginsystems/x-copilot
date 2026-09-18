import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearForYouWait,
  forYouDetectedActivity,
  forYouWaitDetected,
  hasDetectedForYouPost,
  latestActivityCursor,
  openForYouWait,
  parseForYouWait,
  readForYouWait,
  settleForYouWait,
  snapshotForYouWait,
  writeForYouWait,
  type ActivityCursor,
} from "./forYouTask.ts";

const ENTERED = Date.parse("2026-09-05T13:00:00.000Z");

const baseline: ActivityCursor = {
  id: "reply-old",
  postedAt: "2026-09-05T11:00:00.000Z",
  kind: "reply",
  url: "https://x.com/i/status/reply-old",
  text: "already attributed",
};

const scoutReply: ActivityCursor = {
  id: "reply-scout",
  postedAt: "2026-09-05T12:50:00.000Z",
  kind: "reply",
  url: "https://x.com/i/status/reply-scout",
  text: "scout reply",
};

const fypReply: ActivityCursor = {
  id: "reply-fyp",
  postedAt: "2026-09-05T13:05:00.000Z",
  kind: "reply",
  url: "https://x.com/i/status/reply-fyp",
  text: "for you reply",
};

describe("latestActivityCursor", () => {
  it("folds ownActivity and history and keeps the newest id", () => {
    assert.equal(latestActivityCursor({}), null);
    assert.equal(
      latestActivityCursor({ ownActivity: baseline })?.id,
      "reply-old",
    );
    assert.deepEqual(
      latestActivityCursor({
        ownActivity: baseline,
        history: [
          {
            replyId: scoutReply.id,
            replyUrl: scoutReply.url,
            postedAt: scoutReply.postedAt,
            at: scoutReply.postedAt,
          },
        ],
      }),
      { ...scoutReply, text: "" },
    );
  });

  it("merges display fields when ownActivity and history share an id", () => {
    const merged = latestActivityCursor({
      ownActivity: { ...scoutReply, text: "from own posts" },
      history: [
        {
          replyId: scoutReply.id,
          postedAt: scoutReply.postedAt,
          at: scoutReply.postedAt,
        },
      ],
    });
    assert.equal(merged?.id, scoutReply.id);
    assert.equal(merged?.text, "from own posts");
  });

  it("picks the newest postedAt even when attribution order is inverted", () => {
    const cursor = latestActivityCursor({
      history: [
        {
          replyId: "older-late",
          postedAt: "2026-09-05T12:00:00.000Z",
          at: "2026-09-05T13:07:00.000Z",
        },
        {
          replyId: fypReply.id,
          replyUrl: fypReply.url,
          postedAt: fypReply.postedAt,
          at: "2026-09-05T13:06:00.000Z",
        },
      ],
    });
    assert.equal(cursor?.id, fypReply.id);
  });

  it("does not treat parent thread text as the reply body", () => {
    const cursor = latestActivityCursor({
      history: [
        {
          replyId: scoutReply.id,
          replyUrl: scoutReply.url,
          postedAt: scoutReply.postedAt,
          at: scoutReply.postedAt,
        },
      ],
    });
    assert.equal(cursor?.text, "");
  });
});

describe("For You wait identity", () => {
  it("opens with an owner, entry time, cursor baseline, and no completion", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    assert.deepEqual(wait, {
      held: true,
      kind: "for_you",
      owner: "u1",
      enteredAt: "2026-09-05T13:00:00.000Z",
      snapshot: snapshotForYouWait(baseline),
      detectedAt: null,
      hit: null,
    });
  });

  it("uses the entry time as the explicit baseline when the cursor is late", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    assert.equal(wait.snapshot, null);
    assert.equal(forYouWaitDetected(wait, null), false);
    assert.equal(forYouWaitDetected(wait, baseline), false);
    assert.equal(forYouWaitDetected(wait, fypReply), true);
  });

  it("late cursor becomes the baseline only when it post-dates nothing", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const settled = settleForYouWait(wait, baseline, ENTERED + 12_000);
    assert.deepEqual(settled.snapshot, snapshotForYouWait(baseline));
    assert.equal(settled.detectedAt, null);
    assert.equal(forYouWaitDetected(settled, baseline), false);
  });

  it("late cursor that post-dates entry marks detection instead of absorbing it", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const settled = settleForYouWait(wait, fypReply, ENTERED + 40_000);
    assert.equal(settled.detectedAt, "2026-09-05T13:00:40.000Z");
    assert.deepEqual(settled.hit, fypReply);
    assert.equal(forYouWaitDetected(settled, fypReply), true);
    assert.deepEqual(forYouDetectedActivity(settled, fypReply), fypReply);
  });

  it("keeps the completing post after a later stale cursor arrives", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const settled = settleForYouWait(wait, fypReply, ENTERED + 40_000);
    assert.deepEqual(forYouDetectedActivity(settled, baseline), fypReply);
  });

  it("detection is monotonic once marked", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    const hit = settleForYouWait(wait, fypReply, ENTERED + 300_000);
    assert.notEqual(hit.detectedAt, null);
    const older = settleForYouWait(hit, baseline, ENTERED + 400_000);
    assert.equal(older, hit);
    assert.equal(forYouWaitDetected(older, baseline), true);
  });

  it("returns the same object when a cursor changes nothing", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    assert.equal(settleForYouWait(wait, baseline), wait);
    assert.equal(settleForYouWait(wait, null), wait);
  });
});

describe("For You wait detection", () => {
  it("does not treat an already-attributed scout reply as a For You post", () => {
    const wait = openForYouWait({
      owner: "u1",
      cursor: baseline,
      now: ENTERED,
    });
    assert.equal(forYouWaitDetected(wait, scoutReply), false);
    assert.equal(forYouDetectedActivity(wait, scoutReply), null);
    const settled = settleForYouWait(wait, scoutReply, ENTERED + 12_000);
    assert.equal(settled, wait);
  });

  it("detects a newer post after the wait opened", () => {
    const wait = openForYouWait({
      owner: "u1",
      cursor: scoutReply,
      now: ENTERED,
    });
    assert.equal(forYouWaitDetected(wait, fypReply), true);
    assert.deepEqual(forYouDetectedActivity(wait, fypReply), fypReply);
  });

  it("does not detect the same id even when coaching timestamps catch up", () => {
    const wait = openForYouWait({
      owner: "u1",
      cursor: scoutReply,
      now: ENTERED,
    });
    assert.equal(
      hasDetectedForYouPost(wait.snapshot!, scoutReply, wait.enteredAt),
      false,
    );
    assert.equal(forYouWaitDetected(wait, scoutReply), false);
  });

  it("does not detect only a UTC day rollover of an older original", () => {
    const yesterday: ActivityCursor = {
      id: "og-1",
      postedAt: "2026-09-04T23:00:00.000Z",
      kind: "original",
      url: "https://x.com/i/status/og-1",
      text: "yesterday",
    };
    const wait = openForYouWait({
      owner: "u1",
      cursor: yesterday,
      now: Date.parse("2026-09-05T08:00:00.000Z"),
    });
    assert.equal(forYouWaitDetected(wait, yesterday), false);
  });

  it("does not attach the baseline cursor as the detected post", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    assert.equal(forYouDetectedActivity(wait, baseline), null);
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
      const wait = openForYouWait({
        owner: "u1",
        cursor: baseline,
        now: ENTERED,
      });
      writeForYouWait(wait);
      assert.deepEqual(readForYouWait("u1"), wait);
      assert.equal(readForYouWait("u2"), null);
      clearForYouWait("u1");
      assert.equal(readForYouWait("u1"), null);
    });
  });

  it("ignores the legacy timestamp snapshot and foreign owners", () => {
    assert.equal(
      parseForYouWait(
        JSON.stringify({
          held: true,
          kind: "for_you",
          owner: "u1",
          enteredAt: "2026-09-05T13:00:00.000Z",
          detectedAt: null,
          snapshot: {
            postsToday: 2,
            postAt: "2026-09-05T12:00:00.000Z",
            replyAt: "2026-09-05T11:00:00.000Z",
          },
        }),
        "u1",
      ),
      null,
    );
    const wait = openForYouWait({
      owner: "u2",
      cursor: baseline,
      now: ENTERED,
    });
    assert.equal(parseForYouWait(JSON.stringify(wait), "u1"), null);
    assert.deepEqual(parseForYouWait(JSON.stringify(wait), "u2"), wait);
    assert.equal(parseForYouWait("not json", "u1"), null);
  });
});
