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
import { getScoutRunRecord } from "./scoutRunStore.ts";

const session = { bearerToken: "test-token" };
let temp: TempPlatformDb | undefined;

afterEach(() => {
  if (temp) closeTempPlatformDb(temp);
  temp = undefined;
});

describe("Scout run records", () => {
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
    assert.equal(record.coolAdditions, 1);
    assert.equal(record.rejectionCounts.links, 1);
    assert.equal(record.rejectionCounts.views, 1);
    assert.equal(record.rejectionCounts.length, 1);
    assert.equal(record.rejectionCounts.articles, 0);
  });
});
