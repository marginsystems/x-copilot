import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { beginCoachingRequest, isNextActionRefresh } from "../desk/useCoaching.ts";
import {
  coachingPath,
  mergeCoachingState,
  mergeNextAction,
  nextActionDayMatches,
  parseCoachingPayload,
  parseDeskBeats,
  parseNextAction,
} from "./coaching.ts";

await describe("coaching request sequences", () => {
  it("keeps a pending lite activity response when a full refresh starts", () => {
    const lite = beginCoachingRequest({ full: 0, lite: 0 }, { lite: true });
    const full = beginCoachingRequest(lite.sequences);
    assert.equal(lite.isCurrent(full.sequences), true);
    assert.equal(full.isCurrent(full.sequences), true);
  }).catch(assert.fail);

  it("keeps a pending full response when lite polling starts", () => {
    const full = beginCoachingRequest({ full: 0, lite: 0 });
    const lite = beginCoachingRequest(full.sequences, { lite: true });
    assert.equal(full.isCurrent(lite.sequences), true);
    assert.equal(lite.isCurrent(lite.sequences), true);
  }).catch(assert.fail);

  it("rejects older responses only within the same request kind", () => {
    const full = beginCoachingRequest({ full: 0, lite: 0 });
    const lite = beginCoachingRequest(full.sequences, { lite: true });
    const newerFull = beginCoachingRequest(lite.sequences, { lite: false });
    assert.equal(full.isCurrent(newerFull.sequences), false);
    assert.equal(lite.isCurrent(newerFull.sequences), true);
    const newerLite = beginCoachingRequest(newerFull.sequences, { lite: true });
    assert.equal(lite.isCurrent(newerLite.sequences), false);
    assert.equal(newerFull.isCurrent(newerLite.sequences), true);
    assert.equal(newerLite.isCurrent(newerLite.sequences), true);
    assert.deepEqual(full.sequences, { full: 1, lite: 0 });
  }).catch(assert.fail);
});

await describe("coaching parsers", () => {
  it("accepts a next-action card and daily missions", () => {
    const parsed = parseCoachingPayload({
      dayUtc: "2026-08-26",
      nextAction: {
        kind: "original",
        text: "Post one original — you marked 2 replies today.",
        updatedAt: "2026-08-26T12:00:00.000Z",
      },
      missions: [
        {
          id: "mark_2",
          label: "Mark 2 replies",
          target: 2,
          progress: 1,
          xpReward: 4,
          completed: false,
          claimed: false,
        },
      ],
      beats: {
        scoutReplyDone: true,
        organicReplyDone: true,
        forkChoice: "reply",
        forkDone: false,
      },
      postsToday: 2,
      originalsToday: 1,
      replyAt: ["2026-08-26T11:00:00.000Z"],
      ownActivity: {
        id: "1899",
        url: "https://x.com/desk/status/1899",
        text: "A detected reply",
        kind: "reply",
        postedAt: "2026-08-26T11:00:00.000Z",
      },
    });
    assert.equal(parsed?.nextAction?.kind, "original");
    assert.equal(parsed?.postsToday, 2);
    assert.equal(parsed?.originalsToday, 1);
    assert.deepEqual(parsed?.replyAt, ["2026-08-26T11:00:00.000Z"]);
    assert.equal(parsed?.ownActivity?.id, "1899");
    assert.equal(parsed?.missions.length, 1);
    assert.equal(parsed?.missions[0]?.progress, 1);
    assert.deepEqual(parsed?.beats, {
      scoutReplyDone: true,
      organicReplyDone: true,
      forkChoice: "reply",
      forkDone: false,
    });
  }).catch(assert.fail);

  it("falls back to empty beats without rejecting coaching", () => {
    const empty = {
      scoutReplyDone: false,
      organicReplyDone: false,
      forkChoice: null,
      forkDone: false,
    };
    assert.deepEqual(parseDeskBeats(undefined), empty);
    assert.deepEqual(
      parseDeskBeats({
        scoutReplyDone: true,
        organicReplyDone: "yes",
        forkChoice: null,
        forkDone: false,
      }),
      empty,
    );
    assert.deepEqual(parseCoachingPayload({ dayUtc: "2026-08-26" })?.beats, empty);
    assert.equal(parseCoachingPayload({ dayUtc: "2026-08-26" })?.postsToday, 0);
    assert.equal(parseCoachingPayload({ dayUtc: "2026-08-26" })?.originalsToday, 0);
    assert.deepEqual(parseCoachingPayload({ dayUtc: "2026-08-26" })?.replyAt, []);
  }).catch(assert.fail);

  it("drops unknown next-action kinds", () => {
    assert.equal(
      parseNextAction({ kind: "dance", text: "go" }),
      null,
    );
  }).catch(assert.fail);

  it("merges lite coaching without dropping full coaching fields", () => {
    const full = parseCoachingPayload({
      dayUtc: "2026-08-26",
      nextAction: {
        kind: "original",
        text: "Post one original.",
        updatedAt: "2026-08-26T12:00:00.000Z",
      },
      missions: [
        {
          id: "original_1",
          label: "Post 1 original",
          target: 1,
          progress: 0,
          xpReward: 3,
          completed: false,
          claimed: false,
        },
      ],
      originalAt: ["2026-08-26T10:00:00.000Z"],
    });
    const lite = parseCoachingPayload({
      dayUtc: "2026-08-26",
      postsToday: 2,
      originalsToday: 1,
      postAt: ["2026-08-26T13:00:00.000Z"],
      replyAt: ["2026-08-26T12:30:00.000Z"],
      ownActivity: {
        id: "1900",
        url: "https://x.com/i/status/1900",
        text: "Latest post",
        kind: "original",
        postedAt: "2026-08-26T13:00:00.000Z",
      },
    });
    assert.ok(full);
    assert.ok(lite);
    const merged = mergeCoachingState(full, lite, { lite: true });
    assert.equal(merged.nextAction?.kind, "original");
    assert.equal(merged.missions.length, 1);
    assert.deepEqual(merged.originalAt, full.originalAt);
    assert.equal(merged.postsToday, 2);
    assert.deepEqual(merged.postAt, lite.postAt);
    assert.equal(merged.ownActivity?.id, "1900");
  }).catch(assert.fail);

  it("folds lite timestamps into full histories and detects newer activity", () => {
    const full = parseCoachingPayload({
      dayUtc: "2026-08-26",
      beats: {},
      replyAt: ["2026-08-26T10:00:00.000Z", "2026-08-26T09:00:00.000Z"],
      postAt: ["2026-08-26T10:30:00.000Z"],
    });
    const lite = parseCoachingPayload({
      dayUtc: "2026-08-26",
      beats: {},
      replyAt: ["2026-08-26T11:00:00.000Z"],
      postAt: ["2026-08-26T11:30:00.000Z"],
    });
    assert.ok(full);
    assert.ok(lite);
    const merged = mergeCoachingState(full, lite, { lite: true });
    assert.deepEqual(merged.replyAt, [
      "2026-08-26T11:00:00.000Z",
      "2026-08-26T10:00:00.000Z",
      "2026-08-26T09:00:00.000Z",
    ]);
    assert.deepEqual(merged.postAt, [
      "2026-08-26T11:30:00.000Z",
      "2026-08-26T10:30:00.000Z",
    ]);
  }).catch(assert.fail);

  it("keeps newer lite fields when a full response arrives late", () => {
    const full = parseCoachingPayload({
      dayUtc: "2026-08-26",
      postsToday: 1,
      originalsToday: 1,
      beats: {
        scoutReplyDone: false,
        organicReplyDone: false,
        forkChoice: null,
        forkDone: false,
      },
      missions: [
        {
          id: "original_1",
          label: "Post 1 original",
          target: 1,
          progress: 0,
          xpReward: 3,
          completed: false,
          claimed: false,
        },
      ],
    });
    const lite = parseCoachingPayload({
      dayUtc: "2026-08-26",
      postsToday: 3,
      originalsToday: 2,
      beats: {
        scoutReplyDone: true,
        organicReplyDone: true,
        forkChoice: "reply",
        forkDone: true,
      },
    });
    assert.ok(full);
    assert.ok(lite);
    const merged = mergeCoachingState(full, lite, { lite: true });
    const lateFull = mergeCoachingState(full, merged, { lite: true });
    assert.equal(lateFull.postsToday, 3);
    assert.equal(lateFull.originalsToday, 2);
    assert.deepEqual(lateFull.beats, merged.beats);
    assert.deepEqual(lateFull.missions, full.missions);
  }).catch(assert.fail);


});

await describe("parseDeskBeats", () => {
  it("keeps a valid fork choice and rejects a bad one", () => {
    assert.equal(
      parseDeskBeats({
        scoutReplyDone: true,
        organicReplyDone: true,
        forkChoice: "original",
        forkDone: false,
      }).forkChoice,
      "original",
    );
    assert.equal(
      parseDeskBeats({
        scoutReplyDone: true,
        organicReplyDone: true,
        forkChoice: "dance",
        forkDone: false,
      }).forkChoice,
      null,
    );
  }).catch(assert.fail);
});

await describe("post-boot next action refresh", () => {
  it("requests the next-action path and never the full payload", () => {
    assert.equal(coachingPath(), "/api/coaching");
    assert.equal(coachingPath({ lite: true }), "/api/coaching?lite=1");
    assert.equal(coachingPath({ nextAction: true }), "/api/coaching?nextAction=1");
  }).catch(assert.fail);

  it("replaces only nextAction on the boot coaching", () => {
    const boot = parseCoachingPayload({
      dayUtc: "2026-09-28",
      nextAction: null,
      missions: [{ id: "reply_2", label: "Mark two replies", target: 2, progress: 1, xpReward: 10 }],
      postsToday: 3,
      replyAt: ["2026-09-28T01:00:00.000Z"],
    });
    const ownActivity = {
      id: "1900",
      url: "https://x.com/i/status/1900",
      text: "Latest post",
      kind: "original",
      postedAt: "2026-09-28T01:30:00.000Z",
    };
    const next = parseCoachingPayload({
      dayUtc: "2026-09-28",
      nextAction: { kind: "reply", text: "Reply to one thread.", updatedAt: "2026-09-28T02:00:00.000Z" },
      ownActivity,
    });
    assert.ok(boot);
    assert.ok(next);
    const merged = mergeNextAction(boot, next);
    assert.equal(merged?.nextAction?.text, "Reply to one thread.");
    assert.deepEqual(merged?.ownActivity, ownActivity);
    assert.deepEqual(merged?.missions, boot.missions);
    assert.equal(merged?.postsToday, 3);
    assert.deepEqual(merged?.replyAt, boot.replyAt);
    assert.equal(mergeNextAction(null, next), null);
  }).catch(assert.fail);

  it("does not mix a next action from a different UTC day", () => {
    const boot = parseCoachingPayload({ dayUtc: "2026-09-28", nextAction: null, postsToday: 3 });
    const next = parseCoachingPayload({
      dayUtc: "2026-09-29",
      nextAction: { kind: "reply", text: "Reply to one thread.", updatedAt: "2026-09-29T00:00:01.000Z" },
    });
    assert.ok(boot);
    assert.ok(next);
    assert.equal(nextActionDayMatches(boot, next), false);
    assert.equal(nextActionDayMatches(null, next), true);
    assert.equal(mergeNextAction(boot, next), boot);
  }).catch(assert.fail);

  it("treats a lite request as lite even when nextAction is also set", () => {
    assert.equal(isNextActionRefresh({ nextAction: true }), true);
    assert.equal(isNextActionRefresh({ nextAction: true, lite: true }), false);
    assert.equal(isNextActionRefresh(), false);
    assert.equal(coachingPath({ nextAction: true, lite: true }), "/api/coaching?lite=1");
  }).catch(assert.fail);
});
