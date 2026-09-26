import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OwnActivity } from "../lib/coaching.ts";
import {
  approachDetector,
  DESK_DETECTOR_FALLBACK_MS,
  deskCatchUpDue,
  deskDetectorCheck,
  routeOwnPostWake,
} from "./approachDetector.ts";

await describe("Approach detector routing", async () => {
  await it("detects For You even without a locked card and falls back every five seconds", () => {
    assert.equal(DESK_DETECTOR_FALLBACK_MS, 5_000);
    for (const cardId of [null, "suggestion-1"]) {
      assert.equal(approachDetector("for_you", cardId), "for_you");
      assert.equal(deskDetectorCheck({ active: "for_you" }, false), "for_you");
    }
  });

  await it("detects the locked Scout", () => {
    const active = approachDetector("scout", "scout-1");
    assert.equal(active, "scout");
    assert.equal(deskDetectorCheck({ active }, false), "scout");
  });

  await it("does not check inactive detectors or Scout without a card", () => {
    assert.equal(approachDetector(null, null), null);
    assert.equal(approachDetector(null, "card-1"), null);
    assert.equal(approachDetector("scout", null), null);
    assert.equal(approachDetector("scout", ""), null);
    assert.equal(deskDetectorCheck(null, false), null);
    assert.equal(deskDetectorCheck({ active: null }, false), null);
  });

  await it("keeps one fallback in flight across both detectors", () => {
    for (const active of ["for_you", "scout"] as const) {
      assert.equal(deskDetectorCheck({ active }, true), null);
      assert.equal(deskDetectorCheck({ active }, false), active);
    }
  });

  await it("reads own posts only on a visible return with an active detector and none in flight", () => {
    for (const active of ["for_you", "scout"] as const) {
      assert.equal(deskCatchUpDue({ active }, "visible", false), true);
      assert.equal(deskCatchUpDue({ active }, "visible", true), false);
      assert.equal(deskCatchUpDue({ active }, "hidden", false), false);
    }
    assert.equal(deskCatchUpDue({ active: null }, "visible", false), false);
    assert.equal(deskCatchUpDue(null, "visible", false), false);
  });

  await it("routes an own_post wake to the For You cursor whatever detector is active", () => {
    const payload = {
      id: "post-1",
      kind: "reply",
      postedAt: "2026-09-25T10:00:01.000Z",
      url: "https://x.com/pilot/status/post-1",
      text: "my reply",
    };
    for (const active of ["for_you", "scout", null] as const) {
      const applied: OwnActivity[] = [];
      const route = { active, forYouOwnPost: (activity: OwnActivity) => applied.push(activity) };
      assert.deepEqual(routeOwnPostWake(route, payload), payload);
      assert.deepEqual(applied, [payload]);
    }
  });

  await it("drops an own_post wake without url and text, id, or a valid time", () => {
    const applied: OwnActivity[] = [];
    const route = { forYouOwnPost: (activity: OwnActivity) => applied.push(activity) };
    const base = {
      id: "post-1",
      kind: "original",
      postedAt: "2026-09-25T10:00:01.000Z",
      url: "https://x.com/pilot/status/post-1",
      text: "original",
    };
    assert.equal(routeOwnPostWake(route, { id: "post-1", kind: "reply", postedAt: base.postedAt }), null);
    assert.equal(routeOwnPostWake(route, { ...base, id: " " }), null);
    assert.equal(routeOwnPostWake(route, { ...base, postedAt: "soon" }), null);
    assert.equal(routeOwnPostWake(route, { ...base, kind: "repost" }), null);
    assert.equal(routeOwnPostWake(route, null), null);
    assert.equal(routeOwnPostWake(null, base), null);
    assert.deepEqual(applied, []);
  });
});
