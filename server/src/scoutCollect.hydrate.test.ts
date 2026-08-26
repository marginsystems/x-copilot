import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runScoutCollect } from "./scoutCollect.ts";
import { card, fillBucket } from "./scoutCollect.testHelpers.ts";
import type { ScoutCollectEvent } from "./scoutTypes.ts";
import { normalizeAuthorKey } from "./interactionCooldown.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("runScoutCollect hydrate", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

  it("hydrates reply parents before triage", async () => {
    let hydrateCalls = 0;
    let sawOp = false;
    const id = { n: 0 };

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => {
          if (id.n >= 5) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [],
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: [1, 2, 3, 4, 5].map((n) => {
              id.n += 1;
              return card({
                id: `r${n}`,
                author: `@r${n}`,
                inReplyToId: `op${n}`,
                isReply: true,
                text: "How do you pick which products to build next for your customers?",
              });
            }),
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => {
          hydrateCalls += 1;
          return {
            threads: threads.map((t) => ({
              ...t,
              opAuthor: "@hustler",
              opText:
                "mysaas just crossed $632 revenue this month with 100% profit on the dashboard",
            })),
            unhydratedReplyCount: 0,
          };
        },
        triageThreads: async ({ threads }) => {
          sawOp = threads.every((t) => Boolean(t.opText));
          return {
            threads: threads.map((t) => ({
              ...t,
              engage: "skip" as const,
              baitScore: 90,
              flags: ["promo_op"],
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    assert.equal(hydrateCalls, 1);
    assert.equal(sawOp, true);
  });

  it("suppresses cool replies under a bait-tagged conversation root", async () => {
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
              id: "bait-root",
              author: "@bait",
              conversationId: "bait-root",
              text: "why is Japan so behind in AI what happened?",
            }),
            card({
              id: "victim-reply",
              author: "@victim",
              conversationId: "bait-root",
              inReplyToId: "bait-root",
              isReply: true,
              text: "Japan builds things that have to work on day one.",
            }),
            ...[3, 4, 5].map((n) =>
              card({ id: `pad${n}`, author: `@pad${n}`, text: "filler" }),
            ),
          ],
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({
          threads,
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => ({
          threads: threads.map((t) => {
            if (t.id === "bait-root") {
              return {
                ...t,
                engage: "skip" as const,
                baitScore: 90,
                flags: ["engagement_bait"],
              };
            }
            if (t.id === "victim-reply") {
              return {
                ...t,
                engage: "consider" as const,
                baitScore: 15,
                flags: ["on_agenda"],
              };
            }
            return {
              ...t,
              engage: "skip" as const,
              baitScore: 80,
            };
          }),
        }),
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.coolCount, 0);
    assert.equal(
      (result.event.threads ?? []).some((t) => t.id === "victim-reply"),
      false,
    );
  });

  it("still triages when parent hydrate soft-fails", async () => {
    let triageCalls = 0;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({ ok: false, status: 500, text: async () => { throw new Error("mock network error"); } }) as Response;

    try {
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
            threads: [1, 2, 3, 4, 5].map((n) =>
              card({
                id: `r${n}`,
                author: `@r${n}`,
                inReplyToId: `op${n}`,
                isReply: true,
              }),
            ),
            bottomCursor: null,
          }),
          triageThreads: async ({ threads }) => {
            triageCalls += 1;
            assert.equal(threads.length, 5);
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
      assert.equal(triageCalls, 1);
      assert.equal(result.event.stopReason, "target");
      assert.equal(result.event.unhydratedReplyCount, 5);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("drops self-replies revealed only after hydrate (missing inReplyToScreenName)", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      // Bucket fills with self1 + n1..n4; post-hydrate drops self1 → triage n1..n4.
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
              id: "self1",
              author: "@Kalani_Maluai",
              inReplyToId: "root1",
              isReply: true,
              // GraphQL omitted in_reply_to_screen_name — early filter misses.
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
          threads: threads.map((t) =>
            t.id === "self1"
              ? {
                  ...t,
                  opAuthor: "@Kalani_Maluai",
                  opText: "root of my own thread",
                  opParentDerived: true,
                }
              : t,
          ),
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
    assert.ok(!triageIds.includes("self1"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4"]);
    assert.equal(result.event.stopReason, "target");
  });

  it("drops replies under a hydrated Article parent before triage", async () => {
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
              id: "art-reply",
              author: "@reader",
              inReplyToId: "art1",
              isReply: true,
              text: "Great piece, thanks for writing this up.",
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
          threads: threads.map((t) =>
            t.id === "art-reply"
              ? {
                  ...t,
                  opAuthor: "@writer",
                  opText: "Short article teaser",
                  opLongform: "article" as const,
                  opCharCount: 20,
                  opParentDerived: true,
                }
              : t,
          ),
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
    assert.ok(!triageIds.includes("art-reply"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4"]);
    assert.equal(result.event.stopReason, "target");
  });

  it("drops replies under a parent over the char cap after hydrate", async () => {
    let triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      filters: { maxThreadChars: 400 },
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: [
            card({
              id: "long-parent-reply",
              author: "@reader",
              inReplyToId: "wall1",
              isReply: true,
              text: "This is the bit I keep coming back to.",
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
          threads: threads.map((t) =>
            t.id === "long-parent-reply"
              ? {
                  ...t,
                  opAuthor: "@essayist",
                  opText: "preview",
                  opCharCount: 900,
                  opParentDerived: true,
                }
              : t,
          ),
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
    assert.ok(!triageIds.includes("long-parent-reply"));
    assert.deepEqual(triageIds, ["n1", "n2", "n3", "n4"]);
    assert.equal(result.event.stopReason, "target");
  });

  it("exhausts when the post-hydrate length filter empties a partial bucket", async () => {
    let triageCalls = 0;
    let searchCalls = 0;

    const result = await runScoutCollect({
      queries: ["q1", "q2"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        // First page yields a partial bucket of replies; supply is empty after.
        searchTimeline: async () => {
          searchCalls += 1;
          if (searchCalls === 1) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [1, 2, 3].map((n) =>
                card({
                  id: `r${n}`,
                  author: `@r${n}`,
                  inReplyToId: `op${n}`,
                  isReply: true,
                  text: "How do you pick which products to build?",
                }),
              ),
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: [],
            bottomCursor: null,
          };
        },
        // Hydrate reveals every replied-to parent is oversized.
        hydrateReplyParents: async ({ threads }) => ({
          threads: threads.map((t) => ({
            ...t,
            opAuthor: "@parent",
            opText: "preview",
            opCharCount: 900,
            opParentDerived: true,
          })),
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          triageCalls += 1;
          return { threads };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(triageCalls, 0, "length-emptied bucket must not reach triage");
    assert.equal(result.event.stopReason, "exhausted");
  });

  it("keeps searching when post-hydrate OP links empty a bucket", async () => {
    let searchCalls = 0;
    const triageIds: string[] = [];

    const result = await runScoutCollect({
      queries: ["q1", "q2"],
      bucketSize: 5,
      targetCool: 5,
      session,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        planQueriesFromAgenda: async () => ({
          ok: false as const,
          error: "no_replan",
          message: "no replan",
        }),
        searchTimeline: async () => {
          searchCalls += 1;
          if (searchCalls === 1) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [1, 2, 3].map((n) =>
                card({
                  id: `r${n}`,
                  author: `@r${n}`,
                  inReplyToId: `op${n}`,
                  isReply: true,
                }),
              ),
              bottomCursor: null,
            };
          }
          if (searchCalls === 2) {
            return {
              ok: true as const,
              queryId: "test",
              threads: [4, 5].map((n) =>
                card({
                  id: `r${n}`,
                  author: `@r${n}`,
                  inReplyToId: `op${n}`,
                  isReply: true,
                }),
              ),
              bottomCursor: null,
            };
          }
          return {
            ok: true as const,
            queryId: "test",
            threads: [card({ id: "kept", author: "@kept" })],
            bottomCursor: null,
          };
        },
        hydrateReplyParents: async ({ threads }) => ({
          threads: threads.map((t) =>
            t.isReply
              ? {
                  ...t,
                  opAuthor: "@writer",
                  opText: "Read the rest https://substack.com/p/hello",
                  opParentDerived: true,
                  hasOutboundLink: true,
                }
              : t,
          ),
          unhydratedReplyCount: 0,
        }),
        triageThreads: async ({ threads }) => {
          for (const t of threads) triageIds.push(t.id);
          return {
            threads: threads.map((t) => ({
              ...t,
              engage: "consider" as const,
              baitScore: 15,
            })),
          };
        },
      },
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.ok(searchCalls >= 3);
    assert.deepEqual(triageIds, ["kept"]);
  });

});
