import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatPipelineFunnel, runScoutSearch } from "./scoutRun.ts";
import { card } from "./scoutCollect.testHelpers.ts";
import type { ThreadCard } from "./threadCard.ts";

describe("formatPipelineFunnel", () => {
  it("formats raw → … → triage counts", () => {
    assert.equal(
      formatPipelineFunnel({
        raw: 48,
        afterDedupe: 36,
        afterCooldown: 34,
        afterSelfReply: 28,
        afterLinks: 22,
        afterLength: 18,
        afterHydrateSelfReply: 15,
        afterTriage: 12,
      }),
      "48 → 36 → 34 → 28 → 22 → 18 → 15 → 12",
    );
  });
});

describe("runScoutSearch outbound-link filter", () => {
  const session = {
    bearerToken: "t",
    configured: true,
  };

  const linkThreads = (): ThreadCard[] => [
    card({
      id: "l1",
      author: "@linker",
      text: "Ship this https://example.com/x",
      hasOutboundLink: true,
    }),
    card({ id: "n1", author: "@alice" }),
    card({ id: "n2", author: "@bob" }),
    card({ id: "n3", author: "@carol" }),
  ];

  const deps = {
    searchMany: async () => ({
      queries: ["q1"],
      threads: linkThreads(),
      rawCount: 4,
      errors: [],
    }),
    getAuthorKeysForScoutFilter: async () => new Set<string>(),
    getBlockedConversationIds: async () => new Set<string>(),
    hydrateReplyParents: async ({
      threads,
    }: {
      threads: ThreadCard[];
    }) => ({ threads, unhydratedReplyCount: 0 }),
    triageThreads: async ({ threads }: { threads: ThreadCard[] }) => ({
      threads,
    }),
    saveScoutCache: async () => {},
  };

  it("drops outbound-link threads when the setting is omitted", async () => {
    const result = await runScoutSearch({
      queries: ["q1"],
      session,
      deps,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.event.threads.map((t) => t.id);
    assert.ok(!ids.includes("l1"));
    assert.deepEqual(ids, ["n1", "n2", "n3"]);
    assert.equal(result.event.linkFiltered, 1);
  });

  it("keeps outbound-link threads when the setting is off", async () => {
    const result = await runScoutSearch({
      queries: ["q1"],
      session,
      filters: { dropOutboundLinks: false },
      deps,
    });

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const ids = result.event.threads.map((t) => t.id);
    assert.ok(ids.includes("l1"));
    assert.deepEqual(ids, ["l1", "n1", "n2", "n3"]);
    assert.equal(result.event.linkFiltered, 0);
  });
});
