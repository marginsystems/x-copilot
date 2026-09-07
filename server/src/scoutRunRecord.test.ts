import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "./platformDb.testHelpers.ts";
import { getPlatformDb } from "./db.ts";
import { runScoutCollect } from "./scoutCollect.ts";
import { card } from "./scoutCollect.testHelpers.ts";
import {
  emptyScoutRejectionCounts,
  getScoutRunRecord,
  listRecentScoutRuns,
  saveScoutRunRecord,
} from "./scoutRunStore.ts";

const session = { bearerToken: "test-token" };
let temp: TempPlatformDb | undefined;

afterEach(() => {
  if (temp) closeTempPlatformDb(temp);
  temp = undefined;
});

describe("Scout run records", () => {
  it("lists newest runs first and respects the limit", () => {
    temp = openTempPlatformDb("x-scout-run-list-");
    const userId = seedUser("scout-run-list-user");
    for (const [index, query] of ["old", "middle", "new"].entries()) {
      saveScoutRunRecord({
        id: `run-${index}`,
        userId,
        startedAt: `2026-01-0${index + 1}T00:00:00.000Z`,
        finishedAt: `2026-01-0${index + 1}T00:01:00.000Z`,
        queries: [query],
        uniqueCandidateIds: index,
        rejectionCounts: emptyScoutRejectionCounts(),
        usableAdditions: index,
        coolAdditions: index,
        searchCalls: 1,
        stopReason: "exhausted",
      });
    }

    assert.deepEqual(
      listRecentScoutRuns(userId, 2).map((run) => run.queries),
      [["new"], ["middle"]],
    );
  });

  it("skips malformed query history rows", () => {
    temp = openTempPlatformDb("x-scout-run-malformed-");
    const userId = seedUser("scout-run-malformed-user");
    saveScoutRunRecord({
      id: "valid-run",
      userId,
      startedAt: "2026-01-01T00:00:00.000Z",
      finishedAt: "2026-01-01T00:01:00.000Z",
      queries: ["valid query"],
      uniqueCandidateIds: 1,
      rejectionCounts: emptyScoutRejectionCounts(),
      usableAdditions: 1,
      coolAdditions: 1,
      searchCalls: 1,
      stopReason: "exhausted",
    });
    getPlatformDb()
      .prepare("UPDATE scout_runs SET queries_json = ? WHERE id = ?")
      .run("not-json", "valid-run");

    assert.deepEqual(listRecentScoutRuns(userId, 2), []);
  });

  it("persists exclusive link, view-floor, and length drops", async () => {
    temp = openTempPlatformDb("x-scout-run-");
    const userId = seedUser("scout-run-user");

    const result = await runScoutCollect({
      queries: ["shipping"],
      filters: { minViews: 100, maxThreadChars: 30 },
      bucketSize: 5,
      targetCool: 1,
      userId,
      sortieId: "sortie-1",
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "link",
              author: "@link",
              text: "read https://example.com",
              hasOutboundLink: true,
            }),
            card({ id: "views", author: "@views", views: 99 }),
            card({
              id: "length",
              author: "@length",
              text: "x".repeat(35),
            }),
            ...Array.from({ length: 5 }, (_, index) =>
              card({
                id: `usable-${index}`,
                author: `@usable${index}`,
              }),
            ),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((thread) => ({
            ...thread,
            engage: "consider" as const,
            baitScore: 20,
          })),
        }),
      },
    });

    assert.equal(result.ok, true);
    const row = getPlatformDb()
      .prepare("SELECT id FROM scout_runs")
      .get() as { id: string };
    const record = getScoutRunRecord(row.id);
    assert.ok(record);
    assert.equal(record.userId, userId);
    assert.equal(record.sortieId, "sortie-1");
    assert.deepEqual(record.queries, ["shipping"]);
    assert.equal(record.uniqueCandidateIds, 8);
    assert.equal(record.searchCalls, 1);
    assert.equal(record.usableAdditions, 5);
    assert.equal(record.coolAdditions, 5);
    assert.equal(record.rejectionCounts.links, 1);
    assert.equal(record.rejectionCounts.views, 1);
    assert.equal(record.rejectionCounts.length, 1);
    assert.equal(record.rejectionCounts.articles, 0);
    assert.equal(record.rejectionCounts.reserved, 0);
    assert.equal(record.rejectionCounts.blocked, 0);
  });
});
