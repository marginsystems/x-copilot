import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  missionFillPct,
  nextActionProgress,
  parseCoachingPayload,
  parseDeskBeats,
  parseNextAction,
} from "./coaching.ts";

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
    });
    assert.equal(parsed?.nextAction?.kind, "original");
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
  });

  it("drops unknown next-action kinds", () => {
    assert.equal(
      parseNextAction({ kind: "dance", text: "go" }),
      null,
    );
  });

  it("reads reply progress from the mark_2 mission, not the sentence", () => {
    const mark2 = {
      id: "mark_2",
      label: "Mark 2 replies",
      target: 2,
      progress: 1,
      xpReward: 4,
      completed: false,
      claimed: false,
    };
    const reply = {
      kind: "reply" as const,
      text: "Reply to 1 thread to keep the streak alive and hit 5 replies today.",
      updatedAt: "2026-08-27T12:00:00.000Z",
    };
    assert.deepEqual(nextActionProgress(reply, [mark2]), {
      current: 1,
      target: 2,
      label: "1/2",
    });
    assert.deepEqual(
      nextActionProgress({ ...reply, kind: "streak" }, [
        { ...mark2, progress: 2, completed: true, claimed: true },
      ]),
      { current: 2, target: 2, label: "2/2" },
    );
    assert.equal(nextActionProgress(reply, []), null);
    assert.deepEqual(
      nextActionProgress(
        { ...reply, kind: "original", text: "Post one original." },
        [
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
      ),
      { current: 0, target: 1, label: "0/1" },
    );
    assert.equal(missionFillPct(1, 2), 50);
    assert.equal(missionFillPct(2, 2), 100);
  });
});
