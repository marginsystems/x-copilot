import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCoachingPayload,
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
    });
    assert.equal(parsed?.nextAction?.kind, "original");
    assert.equal(parsed?.missions.length, 1);
    assert.equal(parsed?.missions[0]?.progress, 1);
  });

  it("drops unknown next-action kinds", () => {
    assert.equal(
      parseNextAction({ kind: "dance", text: "go" }),
      null,
    );
  });
});
