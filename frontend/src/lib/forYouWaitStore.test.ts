import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FOR_YOU_WAIT_STORAGE_KEY,
  forYouDetectedActivity,
  openForYouWait,
  settleForYouWait,
  type ActivityCursor,
} from "../../../shared/src/forYouTask.ts";
import { clearForYouWait, readForYouWait, writeForYouWait } from "./forYouWaitStore.ts";

const ENTERED = Date.parse("2026-09-05T13:00:00.000Z");

const baseline: ActivityCursor = {
  id: "reply-old",
  postedAt: "2026-09-05T11:00:00.000Z",
  kind: "reply",
  url: "https://x.com/i/status/reply-old",
  text: "already attributed",
};

const fypReply: ActivityCursor = {
  id: "reply-fyp",
  postedAt: "2026-09-05T13:05:00.000Z",
  kind: "reply",
  url: "https://x.com/i/status/reply-fyp",
  text: "for you reply",
};

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
});
