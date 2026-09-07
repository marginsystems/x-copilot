import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import { scoutPlanHistoryOpts } from "./queryPlanHistory.ts";
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
