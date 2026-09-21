/**
 * C08: Scout memory retrieval is scoped to the authenticated user at every
 * caller — both triage gather paths, invalid-JSON repair, the collector, and
 * the identity-less probe — without changing prompt wording or budgets.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { MemoryHit, SearchMemoryResult } from "../memory/memoryIndex.ts";
import { runScoutCollect } from "./scoutCollect.ts";
import { fillBucket } from "./scoutCollect.testHelpers.ts";
import type { ThreadCard } from "./threadCard.ts";
import {
  buildUserMessage,
  selectMemoryHits,
  triageThreads,
  type MemorySearchFn,
} from "./threadTriage.ts";

type ChatRequest = {
  messages: Array<{ role: string; content: string }>;
};

/** Stub DeepSeek: record each request body and answer from a queue. */
function stubDeepseek(answers: string[]): { requests: ChatRequest[]; restore: () => void } {
  const requests: ChatRequest[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      messages: Array<{ role: string; content: string }>;
    };
    requests.push({ messages: body.messages });
    // Consume the queue; the last answer repeats for any further calls.
    const content = answers.length > 1 ? answers.shift()! : (answers[0] ?? "");
    return new Response(
      JSON.stringify({
        model: "stub",
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function thread(id: string, text = `post ${id}`): ThreadCard {
  return { id, author: "@builder", text, url: `https://x.com/builder/status/${id}` };
}

function item(id: string): Record<string, unknown> {
  return {
    id,
    summary: `about ${id}`,
    baitScore: 20,
    threadKind: "sharp_opinion",
    onAgenda: true,
    engage: "consider",
  };
}

const OWNED_HITS: Record<string, MemoryHit[]> = {
  interaction: [
    { path: "/k/interactions/a-1.md", type: "interaction", score: 0.91, excerpt: "A's own shipping reply" },
  ],
  dismissal: [
    { path: "/k/dismissals/a-2.md", type: "dismissal", score: 0.77, excerpt: "A dismissed favorite-tool bait" },
  ],
};

/** Records every search call; returns A's fixtures only for A. */
function ownerScopedSearch(): { calls: Array<{ userId: string; types?: string[]; query: string }>; search: MemorySearchFn } {
  const calls: Array<{ userId: string; types?: string[]; query: string }> = [];
  const search: MemorySearchFn = async (opts): Promise<SearchMemoryResult> => {
    calls.push({ userId: opts.userId, types: opts.types, query: opts.query });
    if (opts.userId !== "user-a") return { hits: [] };
    const type = opts.types?.[0] ?? "interaction";
    return { hits: OWNED_HITS[type] ?? [] };
  };
  return { calls, search };
}

describe("triageThreads memory scope", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("passes the user to both memory types and quotes only owned excerpts", async () => {
    const threads = [thread("1"), thread("2")];
    const stub = stubDeepseek([JSON.stringify({ items: [item("1"), item("2")] })]);
    restore = stub.restore;
    const { calls, search } = ownerScopedSearch();

    const result = await triageThreads({
      agenda: "Find builders",
      threads,
      apiKey: "test-key",
      userId: "user-a",
      searchMemory: search,
    });
    assert.equal(result.threads.length, 2);
    assert.deepEqual(
      calls.map((c) => [c.userId, c.types?.[0]]),
      [["user-a", "interaction"], ["user-a", "dismissal"]],
    );
    assert.ok(calls.every((c) => c.query.length <= 800));

    assert.equal(stub.requests.length, 1);
    const prompt = stub.requests[0]!.messages[1]!.content;
    assert.match(prompt, /Memory \(advisory/);
    assert.match(prompt, /A's own shipping reply/);
    assert.match(prompt, /A dismissed favorite-tool bait/);

    // Wording and budgets are exactly what the pre-C08 pipeline renders for the same owned hits.
    const expected = buildUserMessage(
      "Find builders",
      threads,
      selectMemoryHits([...OWNED_HITS.interaction!, ...OWNED_HITS.dismissal!]),
      "",
    );
    assert.equal(prompt, expected);
  });

  it("runs with no memory and never calls the search seam without a user", async () => {
    const threads = [thread("1")];
    const stub = stubDeepseek([JSON.stringify({ items: [item("1")] })]);
    restore = stub.restore;
    const { calls, search } = ownerScopedSearch();

    for (const userId of [undefined, "", "  "]) {
      const result = await triageThreads({
        agenda: "Find builders",
        threads,
        apiKey: "test-key",
        userId,
        searchMemory: search,
      });
      assert.equal(result.threads.length, 1);
    }
    assert.equal(calls.length, 0);
    for (const req of stub.requests) {
      assert.doesNotMatch(req.messages[1]!.content, /Memory \(advisory/);
    }
    // Identity-less prompt is byte-identical to the memoryless render.
    assert.equal(stub.requests[0]!.messages[1]!.content, buildUserMessage("Find builders", threads, [], ""));
  });

  it("another user's identity yields that user's (empty) memory, not A's", async () => {
    const stub = stubDeepseek([JSON.stringify({ items: [item("1")] })]);
    restore = stub.restore;
    const { calls, search } = ownerScopedSearch();
    await triageThreads({ threads: [thread("1")], apiKey: "test-key", userId: "user-b", searchMemory: search });
    assert.deepEqual(calls.map((c) => c.userId), ["user-b", "user-b"]);
    assert.doesNotMatch(stub.requests[0]!.messages[1]!.content, /A's own shipping reply/);
  });

  it("invalid-JSON repair reuses the already-scoped prompt without re-searching", async () => {
    const threads = [thread("1")];
    const stub = stubDeepseek(["definitely not json", JSON.stringify({ items: [item("1")] })]);
    restore = stub.restore;
    const { calls, search } = ownerScopedSearch();

    const result = await triageThreads({
      threads,
      apiKey: "test-key",
      userId: "user-a",
      searchMemory: search,
    });
    assert.equal(result.threads.length, 1);
    assert.equal(calls.length, 2, "one gather (two types), no re-gather for repair");
    assert.equal(stub.requests.length, 2);
    const original = stub.requests[0]!.messages[1]!.content;
    const repair = stub.requests[1]!.messages;
    assert.equal(repair[1]!.content, original);
    assert.equal(repair[2]!.role, "assistant");
    assert.equal(repair[2]!.content, "definitely not json");
    assert.match(original, /A's own shipping reply/);
    assert.equal(
      (repair[3]!.content.match(/A's own shipping reply/g) ?? []).length,
      0,
      "repair instruction adds no memory of its own",
    );
  });

  it("missing-item gather is scoped to the same user", async () => {
    const threads = [thread("1"), thread("2")];
    const stub = stubDeepseek([
      JSON.stringify({ items: [item("1")] }),
      JSON.stringify({ items: [item("2")] }),
    ]);
    restore = stub.restore;
    const { calls, search } = ownerScopedSearch();

    const result = await triageThreads({
      agenda: "Find builders",
      threads,
      apiKey: "test-key",
      userId: "user-a",
      searchMemory: search,
    });
    assert.equal(result.threads.length, 2);
    assert.equal(calls.length, 4, "two gathers, two types each");
    assert.ok(calls.every((c) => c.userId === "user-a"));
    assert.equal(stub.requests.length, 2);
    const missingPrompt = stub.requests[1]!.messages[1]!.content;
    assert.match(missingPrompt, /You omitted these ids: \["2"\]/);
    assert.match(missingPrompt, /A's own shipping reply/);
    // Second gather only queried the missing card.
    assert.match(calls[2]!.query, /post 2/);
    assert.doesNotMatch(calls[2]!.query, /post 1/);
  });

  it("caps excerpts at 220 characters after scoping", async () => {
    const stub = stubDeepseek([JSON.stringify({ items: [item("1")] })]);
    restore = stub.restore;
    const long = "L".repeat(500);
    await triageThreads({
      threads: [thread("1")],
      apiKey: "test-key",
      userId: "user-a",
      searchMemory: async (opts) => ({
        hits: opts.types?.[0] === "interaction"
          ? [{ path: "/k/i.md", type: "interaction", score: 0.5, excerpt: long }]
          : [],
      }),
    });
    const prompt = stub.requests[0]!.messages[1]!.content;
    assert.match(prompt, /L{220}"/);
    assert.doesNotMatch(prompt, /L{221}/);
  });
});

describe("runScoutCollect forwards its user to triage", () => {
  const session = { bearerToken: "t", configured: true };

  async function collect(userId: string | undefined): Promise<string | undefined> {
    const id = { n: 0 };
    let seen: string | undefined | null = null;
    await runScoutCollect({
      queries: ["q1"],
      bucketSize: 3,
      targetCool: 1,
      session,
      userId,
      deps: {
        sleep: async () => {},
        getCooledAuthorKeys: async () => new Set(),
        saveScoutCache: async () => {},
        saveScoutRunRecord: () => {},
        // Keep this suite off the durable profile store (C11 run snapshot).
        loadScoutProfile: async () => null,
        searchTimeline: async () => ({
          ok: true as const,
          queryId: "test",
          threads: fillBucket(id, 3),
          bottomCursor: null,
        }),
        hydrateReplyParents: async ({ threads }) => ({ threads, unhydratedReplyCount: 0 }),
        triageThreads: async (opts) => {
          seen = opts.userId;
          return {
            threads: opts.threads.map((t) => ({ ...t, engage: "consider" as const, baitScore: 20 })),
          };
        },
      },
    });
    assert.notEqual(seen, null, "triage was invoked");
    return seen ?? undefined;
  }

  it("passes the run's userId", async () => {
    assert.equal(await collect(" user-a "), "user-a");
  });

  it("passes a blank identity for a userless run so triage disables memory", async () => {
    assert.equal(await collect(undefined), "");
    assert.equal(await collect(""), "");
  });
});

describe("probe-triage-tags runs in memory-disabled mode", () => {
  it("passes no identity and a seam that refuses retrieval", async () => {
    const source = await readFile(
      resolve(import.meta.dirname, "../../../scripts/probe-triage-tags.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /\buserId\s*[:=]/, "probe must not select an identity");
    assert.match(source, /memory retrieval is disabled/);
  });
});
