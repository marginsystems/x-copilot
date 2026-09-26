import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  clearForYouWait,
  FOR_YOU_WAIT_STORAGE_KEY,
  forYouDetectedActivity,
  forYouWaitDetected,
  hasDetectedForYouPost,
  latestActivityCursor,
  newestOwnActivity,
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

await describe("latestActivityCursor", () => {
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
  }).catch(assert.fail);

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
  }).catch(assert.fail);

  it("picks the newest postedAt regardless of history order", () => {
    const older = {
      replyId: "older-late",
      postedAt: "2026-09-05T12:00:00.000Z",
      at: "2026-09-05T13:07:00.000Z",
    };
    const newer = {
      replyId: fypReply.id,
      replyUrl: fypReply.url,
      postedAt: fypReply.postedAt,
      at: "2026-09-05T13:06:00.000Z",
    };
    assert.equal(
      latestActivityCursor({ history: [older, newer] })?.id,
      fypReply.id,
    );
    assert.equal(
      latestActivityCursor({ history: [newer, older] })?.id,
      fypReply.id,
    );
  }).catch(assert.fail);

  it("prefers own activity when timestamps tie", () => {
    const own = { ...fypReply, id: "own-tie" };
    assert.equal(
      latestActivityCursor({
        ownActivity: own,
        history: [
          {
            replyId: fypReply.id,
            postedAt: fypReply.postedAt,
            at: fypReply.postedAt,
          },
        ],
      })?.id,
      own.id,
    );
  }).catch(assert.fail);

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
  }).catch(assert.fail);

});

await describe("For You wait identity", () => {
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
  }).catch(assert.fail);

  it("uses the entry time as the explicit baseline when the cursor is late", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    assert.equal(wait.snapshot, null);
    assert.equal(forYouWaitDetected(wait, null), false);
    assert.equal(forYouWaitDetected(wait, baseline), false);
    assert.equal(forYouWaitDetected(wait, fypReply), true);
  }).catch(assert.fail);

  it("late cursor becomes the baseline only when it post-dates nothing", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const settled = settleForYouWait(wait, baseline, ENTERED + 12_000);
    assert.deepEqual(settled.snapshot, snapshotForYouWait(baseline));
    assert.equal(settled.detectedAt, null);
    assert.equal(forYouWaitDetected(settled, baseline), false);
  }).catch(assert.fail);

  it("late cursor that post-dates entry marks detection instead of absorbing it", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const settled = settleForYouWait(wait, fypReply, ENTERED + 40_000);
    assert.equal(settled.detectedAt, "2026-09-05T13:00:40.000Z");
    assert.deepEqual(settled.hit, fypReply);
    assert.equal(forYouWaitDetected(settled, fypReply), true);
    assert.deepEqual(forYouDetectedActivity(settled, fypReply), fypReply);
  }).catch(assert.fail);

  it("keeps the completing post after a later stale cursor arrives", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const settled = settleForYouWait(wait, fypReply, ENTERED + 40_000);
    assert.deepEqual(forYouDetectedActivity(settled, baseline), fypReply);
  }).catch(assert.fail);

  it("detection is monotonic once marked", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    const hit = settleForYouWait(wait, fypReply, ENTERED + 300_000);
    assert.notEqual(hit.detectedAt, null);
    const older = settleForYouWait(hit, baseline, ENTERED + 400_000);
    assert.equal(older, hit);
    assert.equal(forYouWaitDetected(older, baseline), true);
  }).catch(assert.fail);

  it("returns the same object when a cursor changes nothing", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    assert.equal(settleForYouWait(wait, baseline), wait);
    assert.equal(settleForYouWait(wait, null), wait);
  }).catch(assert.fail);

});

await describe("For You wait detection", () => {
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
  }).catch(assert.fail);

  it("detects a newer post after the wait opened", () => {
    const wait = openForYouWait({
      owner: "u1",
      cursor: scoutReply,
      now: ENTERED,
    });
    assert.equal(forYouWaitDetected(wait, fypReply), true);
    assert.deepEqual(forYouDetectedActivity(wait, fypReply), fypReply);
  }).catch(assert.fail);

  it("does not detect the same id even when coaching timestamps catch up", () => {
    const wait = openForYouWait({
      owner: "u1",
      cursor: scoutReply,
      now: ENTERED,
    });
    const reMarkedScoutReply = {
      ...scoutReply,
      postedAt: "2026-09-05T13:02:00.000Z",
    };
    assert.equal(
      hasDetectedForYouPost(
        wait.snapshot!,
        reMarkedScoutReply,
        wait.enteredAt,
      ),
      false,
    );
    assert.equal(forYouWaitDetected(wait, reMarkedScoutReply), false);
  }).catch(assert.fail);

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
    const olderDistinctCursor = {
      ...yesterday,
      id: "og-repost",
    };
    assert.equal(forYouWaitDetected(wait, olderDistinctCursor), false);
  }).catch(assert.fail);

  it("does not detect an older distinct cursor after absorbing a pre-entry cursor", () => {
    const wait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const absorbed = settleForYouWait(wait, {
      ...scoutReply,
      id: "reply-absorbed",
      postedAt: "2026-09-05T12:50:00.000Z",
    });
    const stale = {
      ...scoutReply,
      id: "reply-stale",
      postedAt: "2026-09-05T11:00:00.000Z",
    };

    assert.equal(forYouWaitDetected(absorbed, stale), false);
    assert.equal(settleForYouWait(absorbed, stale), absorbed);
  }).catch(assert.fail);

  it("does not attach the baseline cursor as the detected post", () => {
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    assert.equal(forYouDetectedActivity(wait, baseline), null);
  }).catch(assert.fail);

});

await describe("own_post wake cursor", () => {
  const ownPost: ActivityCursor = {
    id: "post-wake",
    postedAt: "2026-09-05T13:04:00.000Z",
    kind: "original",
    url: "https://x.com/pilot/status/post-wake",
    text: "posted from the For You card",
  };

  it("becomes the cursor with its url and text while coaching is still stale", () => {
    const cursor = latestActivityCursor({
      ownActivity: baseline,
      ownPost,
      history: [
        {
          replyId: scoutReply.id,
          replyUrl: scoutReply.url,
          postedAt: scoutReply.postedAt,
          at: scoutReply.postedAt,
        },
      ],
    });
    assert.deepEqual(cursor, ownPost);
    const wait = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    assert.equal(forYouWaitDetected(wait, latestActivityCursor({ ownActivity: baseline })), false);
    assert.equal(forYouWaitDetected(wait, cursor), true);
    const settled = settleForYouWait(wait, cursor, ENTERED + 5_000);
    assert.deepEqual(settled.hit, ownPost);
    assert.deepEqual(forYouDetectedActivity(settled, cursor), ownPost);
  }).catch(assert.fail);

  it("does not count the post already on screen or an older late post", () => {
    const onScreen = openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED });
    const replayed = latestActivityCursor({ ownActivity: baseline, ownPost: baseline });
    assert.equal(forYouWaitDetected(onScreen, replayed), false);
    assert.equal(settleForYouWait(onScreen, replayed), onScreen);

    const lateWait = openForYouWait({ owner: "u1", cursor: null, now: ENTERED });
    const latePost = { ...ownPost, id: "post-late", postedAt: "2026-09-05T12:55:00.000Z" };
    const lateCursor = latestActivityCursor({ ownPost: latePost });
    assert.equal(forYouWaitDetected(lateWait, lateCursor), false);
    const absorbed = settleForYouWait(lateWait, lateCursor, ENTERED + 5_000);
    assert.equal(absorbed.detectedAt, null);
    assert.deepEqual(absorbed.snapshot, snapshotForYouWait(latePost));
  }).catch(assert.fail);

  it("keeps the newest wake when an older one is replayed", () => {
    assert.equal(newestOwnActivity(null, ownPost), ownPost);
    assert.equal(newestOwnActivity(ownPost, baseline), ownPost);
    assert.equal(newestOwnActivity(baseline, ownPost), ownPost);
    assert.equal(newestOwnActivity(ownPost, { ...ownPost, id: " " }), ownPost);
  }).catch(assert.fail);
});

await describe("For You wait storage", () => {
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
      const settled = settleForYouWait(wait, fypReply, ENTERED + 40_000);
      writeForYouWait(settled);
      const restored = readForYouWait("u1");
      assert.deepEqual(restored?.hit, fypReply);
      assert.deepEqual(forYouDetectedActivity(restored!, baseline), fypReply);
      assert.equal(readForYouWait("u2"), null);
      clearForYouWait("u1");
      assert.equal(readForYouWait("u1"), null);
    });
  }).catch(assert.fail);

  it("round-trips a held wait without a cursor snapshot", () => {
    withSessionStorage(() => {
      writeForYouWait(
        openForYouWait({ owner: "u1", cursor: null, now: ENTERED }),
      );
      const restored = readForYouWait("u1");
      assert.equal(restored?.held, true);
      assert.equal(restored?.snapshot, null);
      assert.equal(restored?.detectedAt, null);
    });
  }).catch(assert.fail);

  it("rejects a wait with a malformed persisted hit", () => {
    withSessionStorage(() => {
      const wait = settleForYouWait(
        openForYouWait({ owner: "u1", cursor: baseline, now: ENTERED }),
        fypReply,
        ENTERED + 40_000,
      );
      sessionStorage.setItem(
        `${FOR_YOU_WAIT_STORAGE_KEY}:u1`,
        JSON.stringify({ ...wait, hit: { ...fypReply, kind: "repost" } }),
      );
      assert.equal(readForYouWait("u1"), null);
    });
  }).catch(assert.fail);

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
  }).catch(assert.fail);
});
