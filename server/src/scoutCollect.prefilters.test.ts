import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutCollect } from "./scoutCollect.ts";
import { card, fillBucket } from "./scoutCollect.testHelpers.ts";
import type { ScoutCollectEvent } from "./scoutTypes.ts";
import { normalizeAuthorKey } from "./interactionCooldown.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("runScoutCollect prefilters", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

  it("keeps at most one card per author in the bucket", async () => {
    let triageAuthors: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({ id: "s1", author: "@same" }),
            card({ id: "s2", author: "@same" }),
            card({ id: "s3", author: "@Same" }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageAuthors = threads.map((t) => t.author);
          assert.equal(
            threads.filter((t) => normalizeAuthorKey(t.author) === "same")
              .length,
            1,
          );
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageAuthors.length, 5);
    assert.equal(result.event.stopReason, "target");
  });

  it("drops outbound-link cards before triage", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
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
              id: "l1",
              author: "@linker",
              text: "Ship this https://example.com/x",
              hasOutboundLink: true,
            }),
            card({
              id: "l2",
              author: "@texturl",
              text: "See https://example.com/abc for details",
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.ok(!triageIds.includes("l1") && !triageIds.includes("l2"));
    assert.equal(result.event.stopReason, "target");
  });

  it("drops media and hashtag cards before triage", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
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
              id: "m1",
              author: "@photos",
              text: "interview dump",
              mediaShortlinks: ["t.co/zk5ziekdnn"],
            }),
            card({
              id: "h1",
              author: "@tags",
              text: "Ship this #buildinpublic",
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.ok(!triageIds.includes("m1") && !triageIds.includes("h1"));
    assert.equal(result.event.stopReason, "target");
  });

  it("keeps outbound-link cards when the setting is off", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      filters: { dropOutboundLinks: false },
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "l1",
              author: "@linker",
              text: "Ship this https://example.com/x",
              hasOutboundLink: true,
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(triageIds.includes("l1"));
    assert.equal(result.event.stopReason, "target");
  });

  it("drops self-replies before triage", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
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
              id: "s1",
              author: "@jack",
              inReplyToId: "0",
              inReplyToScreenName: "@jack",
            }),
            card({
              id: "s2",
              author: "@jack",
              inReplyToId: "0",
              inReplyToScreenName: "jack",
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.ok(!triageIds.includes("s1") && !triageIds.includes("s2"));
    assert.equal(result.event.stopReason, "target");
  });

  it("drops non-preferred-language cards before triage", async () => {
    let triageIds: string[] = [];
    const spanish =
      "Ahora que todos están quejándose de build in public, voy yo: dejé de hacer build in public porque me copiaban todo, literalmente todo, hasta las publicaciones sobre qué roles contratábamos.";

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      filters: { preferredLanguage: "en" },
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "es1",
              author: "@ssebita_r",
              text: spanish,
            }),
            card({ id: "n1", author: "@alice" }),
            card({ id: "n2", author: "@bob" }),
            card({ id: "n3", author: "@carol" }),
            card({ id: "n4", author: "@dave" }),
            card({ id: "n5", author: "@erin" }),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageIds = threads.map((t) => t.id);
          return {
            threads: threads.map((t, i) => ({
              ...t,
              engage: i === 0 ? ("consider" as const) : ("skip" as const),
              baitScore: i === 0 ? 20 : 80,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(!triageIds.includes("es1"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4", "n5"]);
    assert.equal(result.event.stopReason, "target");
  });

});
