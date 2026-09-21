import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import {
  mergeScoutPlanHistoryOpts,
  scoutPlanHistoryOpts,
} from "./queryPlanHistory.ts";
import { emptyScoutProfile } from "./scoutProfile.ts";
import {
  emptyScoutRejectionCounts,
  saveScoutRunRecord,
} from "./scoutRunStore.ts";

let temp: TempPlatformDb | undefined;

afterEach(() => {
  if (temp) closeTempPlatformDb(temp);
  temp = undefined;
});

describe("scoutPlanHistoryOpts", () => {
  it("returns undefined for an empty user or no runs", () => {
    assert.equal(scoutPlanHistoryOpts(""), undefined);
    temp = openTempPlatformDb("x-plan-history-empty-");
    assert.equal(scoutPlanHistoryOpts(seedUser("history-empty")), undefined);
  });

  it("formats yield and dedupes prior queries", () => {
    temp = openTempPlatformDb("x-plan-history-");
    const userId = seedUser("history-user");
    const save = (
      id: string,
      finishedAt: string,
      queries: string[],
      uniqueCandidateIds: number,
      coolAdditions: number,
    ) =>
      saveScoutRunRecord({
        id,
        userId,
        startedAt: finishedAt,
        finishedAt,
        queries,
        uniqueCandidateIds,
        rejectionCounts: emptyScoutRejectionCounts(),
        usableAdditions: 2,
        coolAdditions,
        searchCalls: 8,
        stopReason: "exhausted",
      });
    save("older", "2026-01-01T00:00:00.000Z", ["freight tools", "dock claims"], 75, 0);
    save("newer", "2026-01-02T00:00:00.000Z", ["dock claims", "carrier ops"], 0, 0);

    const opts = scoutPlanHistoryOpts(userId);
    assert.deepEqual(opts?.priorQueries, [
      "dock claims",
      "carrier ops",
      "freight tools",
    ]);
    assert.match(
      opts?.yieldNote ?? "",
      /unique=0 usable=2 cool=0 calls=8 queries=\["dock claims","carrier ops"\]/,
    );
    assert.match(opts?.yieldNote ?? "", /unique=75 usable=2 cool=0 calls=8/);
  });
});

describe("mergeScoutPlanHistoryOpts", () => {
  it("keeps the run's profile snapshot and other opts while deduping history", () => {
    temp = openTempPlatformDb("x-plan-history-merge-");
    const userId = seedUser("history-merge-user");
    saveScoutRunRecord({
      id: "prior",
      userId,
      startedAt: "2026-01-02T00:00:00.000Z",
      finishedAt: "2026-01-02T00:00:00.000Z",
      queries: ["dock claims", "carrier ops"],
      uniqueCandidateIds: 0,
      rejectionCounts: emptyScoutRejectionCounts(),
      usableAdditions: 2,
      coolAdditions: 0,
      searchCalls: 8,
      stopReason: "exhausted",
    });
    const profile = emptyScoutProfile(userId);

    const merged = mergeScoutPlanHistoryOpts(userId, {
      broaden: true,
      priorQueries: ["carrier ops", "freight software"],
      yieldNote: "Low yield",
      profile,
    });
    assert.equal(merged.profile, profile, "same snapshot object, not a copy");
    assert.equal(merged.broaden, true);
    assert.deepEqual(merged.priorQueries, [
      "carrier ops",
      "freight software",
      "dock claims",
    ]);
    assert.match(
      merged.yieldNote ?? "",
      /^unique=0 usable=2 cool=0 calls=8 queries=\["dock claims","carrier ops"\]; Low yield$/,
    );

    // Same history strings whether or not a profile rides along.
    const without = mergeScoutPlanHistoryOpts(userId, {
      broaden: true,
      priorQueries: ["carrier ops", "freight software"],
      yieldNote: "Low yield",
    });
    assert.deepEqual(without.priorQueries, merged.priorQueries);
    assert.equal(without.yieldNote, merged.yieldNote);
    assert.equal("profile" in without, false);

    // No history: the caller's object comes back untouched.
    const fresh = { broaden: true, profile };
    assert.equal(mergeScoutPlanHistoryOpts(seedUser("history-none-user"), fresh), fresh);
  });
});
