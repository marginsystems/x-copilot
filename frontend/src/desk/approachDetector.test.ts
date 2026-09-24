import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { approachDetectorRefresh, approachDetectorSchedule } from "./approachDetector.ts";

await describe("Approach detector scheduling", async () => {
  await it("listens for For You even without a locked card and polls every five seconds", () => {
    for (const cardId of [null, "suggestion-1"]) {
      const schedule = approachDetectorSchedule("for_you", cardId);
      assert.deepEqual(schedule, {
        target: { detector: "for_you" },
        intervalMs: 5_000,
        ownPostRetryMs: null,
      });
      assert.deepEqual(approachDetectorRefresh(schedule, false), { detector: "for_you" });
    }
  });

  await it("hydrates the locked Scout and retries an own-post wake after one second", () => {
    const schedule = approachDetectorSchedule("scout", "scout-1");
    assert.deepEqual(schedule, {
      target: { detector: "scout", cardId: "scout-1" },
      intervalMs: 5_000,
      ownPostRetryMs: 1_000,
    });
    assert.deepEqual(approachDetectorRefresh(schedule, false), {
      detector: "scout", cardId: "scout-1",
    });
  });

  await it("does not listen or refresh for inactive detectors or Scout without a card", () => {
    assert.equal(approachDetectorSchedule(null, null), null);
    assert.equal(approachDetectorSchedule(null, "card-1"), null);
    assert.equal(approachDetectorSchedule("scout", null), null);
    assert.equal(approachDetectorSchedule("scout", ""), null);
    assert.equal(approachDetectorRefresh(null, false), null);
  });

  await it("skips pending ticks for either detector and allows the next settled tick", () => {
    for (const detector of ["for_you", "scout"] as const) {
      const schedule = approachDetectorSchedule(detector, "card-1");
      assert.ok(schedule);
      const target = approachDetectorRefresh(schedule, false);
      assert.equal(target, schedule.target);
      assert.equal(approachDetectorRefresh(schedule, true), null);
      assert.equal(approachDetectorRefresh(schedule, true), null);
      assert.equal(approachDetectorRefresh(schedule, false), target);
    }
  });
});
