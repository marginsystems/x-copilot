import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mergeCoachingState,
  parseCoachingPayload,
  parseDeskBeats,
  parseNextAction,
} from "./coaching.ts";
import { hasDetectedForYouPost } from "./forYouTask.ts";

describe("coaching parsers", () => {
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
  });

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
  });

  it("drops unknown next-action kinds", () => {
    assert.equal(
      parseNextAction({ kind: "dance", text: "go" }),
      null,
    );
  });

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
  });

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
    assert.equal(
      hasDetectedForYouPost(
        { postsToday: 0, postAt: "2026-08-26T10:45:00.000Z", replyAt: null },
        merged,
      ),
      true,
    );
  });

});

describe("parseDeskBeats", () => {
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
  });
});
