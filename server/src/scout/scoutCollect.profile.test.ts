import { isRecord } from "../platform/unknownValue.js";
/**
 * C11: the collector takes exactly one owned ScoutProfile snapshot per run
 * and carries that same object into the initial plan, the low-yield replan
 * and the planner's own repair/broaden requests. Blank identity performs no
 * read; a throwing loader or a foreign profile never fails collection and
 * never leaks another profile.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import type { PlanQueriesOpts } from "./queryPlan.ts";
import { runScoutCollect, type ScoutCollectDeps } from "./scoutCollect.ts";
import { fillBucket } from "./scoutCollect.testHelpers.ts";
import {
  emptyScoutProfile,
  reduceScoutProfile,
  type ScoutProfile,
  type ScoutProfileObservation,
} from "./scoutProfile.ts";
import { SCOUT_PROFILE_BLOCK_HEADER } from "./scoutProfilePrompt.ts";
import type { ThreadKind } from "./threadTriage.ts";

const session = { bearerToken: "t", configured: true };

let temp: TempPlatformDb | undefined;
let prevKey: string | undefined;
let restoreFetch: (() => void) | null = null;

afterEach(() => {
  if (temp) closeTempPlatformDb(temp);
  temp = undefined;
  restoreFetch?.();
  restoreFetch = null;
  if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = prevKey;
});

function withLlmKey(): void {
  prevKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "test-key";
}

// ---------------------------------------------------------------- fixtures

let seq = 0;
function obs(
  o: Partial<ScoutProfileObservation> & { action: ScoutProfileObservation["action"] },
): ScoutProfileObservation {
  seq += 1;
  const at = `2026-09-01T00:${String(Math.floor(seq / 60) % 60).padStart(2, "0")}:${String(seq % 60).padStart(2, "0")}.000Z`;
  return {
    eventKey: `${o.action}:e${seq}`,
    action: o.action,
    at,
    changedAt: at,
    targetId: `t${seq}`,
    targetAliases: [],
    threadKind: o.threadKind ?? null,
    author: o.author ?? null,
    topics: o.topics ?? [],
    replyId: o.action === "take" ? `r${seq}` : null,
    storedReplyVerified: o.action === "take",
  };
}
function takes(n: number, kind: ThreadKind, extra: Partial<ScoutProfileObservation> = {}) {
  return Array.from({ length: n }, () => obs({ action: "take", threadKind: kind, ...extra }));
}
function skips(n: number, kind: ThreadKind) {
  return Array.from({ length: n }, () => obs({ action: "skip", threadKind: kind }));
}

function supportedProfile(userId: string, revision = 1): ScoutProfile {
  return reduceScoutProfile({
    userId,
    revision,
    updatedAt: "2026-09-02T00:00:00.000Z",
    observations: [
      ...takes(4, "fact_add", { topics: ["freight"], author: "carrierco" }),
      ...skips(1, "fact_add"),
      ...takes(1, "timely_take"),
      ...skips(4, "timely_take"),
    ],
  });
}

type PlanCall = { agenda: string; opts?: PlanQueriesOpts };

function stubDeps(
  overrides: Partial<ScoutCollectDeps> & {
    planCalls?: PlanCall[];
    emptySearch?: boolean;
  } = {},
): ScoutCollectDeps {
  const id = { n: 0 };
  const { planCalls, emptySearch, ...rest } = overrides;
  return {
    sleep: async () => {},
    getCooledAuthorKeys: async () => new Set(),
    saveScoutCache: async () => {},
    saveScoutRunRecord: () => {},
    searchTimeline: async () => ({
      ok: true as const,
      queryId: "test",
      threads: emptySearch ? [] : fillBucket(id, 5),
      bottomCursor: null,
    }),
    hydrateReplyParents: async ({ threads }) => ({ threads, unhydratedReplyCount: 0 }),
    triageThreads: async ({ threads }) => ({
      threads: threads.map((t) => ({ ...t, engage: "consider" as const, baitScore: 20 })),
    }),
    ...(planCalls
      ? {
          planQueriesFromAgenda: async (agenda: string, opts?: PlanQueriesOpts) => {
            planCalls.push({ agenda, opts });
            return {
              ok: true as const,
              queries: planCalls.length === 1 ? ["q1", "q2"] : ["broad freight", "freight ops"],
              model: "test",
              provider: "deepseek" as const,
              raw: "{}",
            };
          },
        }
      : {}),
    ...rest,
  };
}

function spyLoader(backing: () => ScoutProfile | null | undefined | Promise<ScoutProfile | null>) {
  const calls: string[] = [];
  const loadScoutProfile = async (userId: string) => {
    calls.push(userId);
    return backing();
  };
  return { calls, loadScoutProfile };
}

await describe("runScoutCollect — one owned profile snapshot per run", async () => {
  await it("reads once with the trimmed userId, even for explicit client queries", async () => {
    const profile = supportedProfile("user-a");
    const loader = spyLoader(() => profile);
    const planCalls: PlanCall[] = [];
    const result = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      userId: " user-a ",
      session,
      deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, planCalls }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(loader.calls, ["user-a"]);
    assert.equal(planCalls.length, 0, "explicit queries still bypass the initial planner");
  });

  await it("performs zero reads without an identity", async () => {
    for (const userId of [undefined, "", "   "]) {
      const loader = spyLoader(() => supportedProfile("user-a"));
      const result = await runScoutCollect({
        queries: ["q1"],
        bucketSize: 5,
        targetCool: 1,
        userId,
        session,
        deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile }),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(loader.calls, []);
    }
  });

  await it("does not read before early credential or input failures", async () => {
    const loader = spyLoader(() => supportedProfile("user-a"));
    const deps = stubDeps({ loadScoutProfile: loader.loadScoutProfile });
    const noCreds = await runScoutCollect({
      queries: ["q1"],
      userId: "user-a",
      session: { bearerToken: "", configured: false },
      deps,
    });
    assert.equal(noCreds.ok, false);
    const noAgenda = await runScoutCollect({ userId: "user-a", session, deps });
    assert.equal(noAgenda.ok, false);
    assert.equal(!noAgenda.ok && noAgenda.error, "missing_agenda");
    const noKey = await runScoutCollect({ agenda: "B2B freight OS", userId: "user-a", session, deps });
    assert.equal(noKey.ok, false);
    assert.equal(!noKey.ok && noKey.error, "missing_llm_key");
    assert.deepEqual(loader.calls, []);
  });

  await it("a throwing loader does not fail collection and supplies no profile", async () => {
    withLlmKey();
    temp = openTempPlatformDb("x-scout-profile-throw-");
    const userId = seedUser("profile-throw-user");
    const loader = spyLoader(() => {
      throw new Error("store offline");
    });
    const planCalls: PlanCall[] = [];
    const result = await runScoutCollect({
      agenda: "B2B freight OS",
      bucketSize: 5,
      targetCool: 1,
      userId,
      session,
      deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, planCalls }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(loader.calls, [userId]);
    assert.equal(planCalls.length, 1);
    assert.equal(planCalls[0]?.opts, undefined, "no history, no profile → undefined opts as before");
  });

  await it("a foreign or absent profile is dropped without a retry or fallback owner", async () => {
    withLlmKey();
    temp = openTempPlatformDb("x-scout-profile-foreign-");
    const userId = seedUser("profile-foreign-user");
    for (const backing of [
      () => supportedProfile("someone-else"),
      () => null,
      () => undefined,
      () => (unsupportedVersionProfile(supportedProfile(userId))),
    ]) {
      const loader = spyLoader(backing);
      const planCalls: PlanCall[] = [];
      const result = await runScoutCollect({
        agenda: "B2B freight OS",
        bucketSize: 5,
        targetCool: 1,
        userId,
        session,
        deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, planCalls }),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(loader.calls, [userId]);
      assert.equal(planCalls[0]?.opts, undefined);
    }
  });

  await it("the same object reaches the initial plan and the low-yield replan; no second read mid-run", async () => {
    withLlmKey();
    temp = openTempPlatformDb("x-scout-profile-replan-");
    const userId = seedUser("profile-replan-user");
    let backing = supportedProfile(userId, 1);
    const loader = spyLoader(() => backing);
    const planCalls: PlanCall[] = [];
    const deps = stubDeps({ loadScoutProfile: loader.loadScoutProfile, planCalls, emptySearch: true });
    const search = deps.searchTimeline!;
    deps.searchTimeline = async (opts) => {
      // Evidence changes mid-run: visible only to the next run.
      backing = supportedProfile(userId, 2);
      return search(opts);
    };

    const first = await runScoutCollect({
      agenda: "B2B freight OS",
      bucketSize: 5,
      targetCool: 1,
      userId,
      session,
      deps,
    });
    assert.equal(first.ok, true);
    assert.deepEqual(loader.calls, [userId], "exactly one read for the whole run");
    assert.ok(planCalls.length >= 2, "initial plan + replan");
    assert.equal(planCalls[0]?.opts?.broaden, undefined);
    assert.equal(planCalls[1]?.opts?.broaden, true);
    assert.equal(planCalls[0]?.opts?.profile?.revision, 1);
    assert.equal(planCalls[1]?.opts?.profile, planCalls[0]?.opts?.profile, "same snapshot object");
    assert.deepEqual(planCalls[1]?.opts?.priorQueries, ["q1", "q2"]);
    assert.match(planCalls[1]?.opts?.yieldNote ?? "", /Low yield/);

    const second = await runScoutCollect({
      agenda: "B2B freight OS",
      bucketSize: 5,
      targetCool: 1,
      userId,
      session,
      deps,
    });
    assert.equal(second.ok, true);
    assert.deepEqual(loader.calls, [userId, userId]);
    assert.equal(planCalls[2]?.opts?.profile?.revision, 2, "next run sees the new revision");
  });

  await it("profile availability adds no planning call; explicit queries still replan as before", async () => {
    withLlmKey();
    temp = openTempPlatformDb("x-scout-profile-budget-");
    const userId = seedUser("profile-budget-user");
    const run = async (profile: ScoutProfile | null) => {
      const planCalls: PlanCall[] = [];
      const loader = spyLoader(() => profile);
      const result = await runScoutCollect({
        agenda: "B2B freight OS",
        queries: ["client query"],
        bucketSize: 5,
        targetCool: 1,
        userId,
        session,
        deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, planCalls, emptySearch: true }),
      });
      assert.equal(result.ok, true);
      assert.deepEqual(loader.calls, [userId]);
      return planCalls;
    };
    const withProfile = await run(supportedProfile(userId));
    const without = await run(null);
    const empty = await run(emptyScoutProfile(userId));
    assert.equal(withProfile.length, without.length);
    assert.equal(empty.length, without.length);
    assert.equal(without.length, 1, "one eligible low-yield replan, no initial plan");
    assert.equal(withProfile[0]?.opts?.broaden, true);
    assert.equal(withProfile[0]?.opts?.profile?.userId, userId);
    assert.equal("profile" in (without[0]?.opts ?? {}), false);
    assert.equal(empty[0]?.opts?.profile?.revision, 0);
    assert.deepEqual(withProfile[0]?.opts?.priorQueries, without[0]?.opts?.priorQueries);
    assert.equal(withProfile[0]?.opts?.yieldNote, without[0]?.opts?.yieldNote);
  });

  await it("with the real planner, initial, JSON repair, broaden and replan all carry one block", async () => {
    withLlmKey();
    temp = openTempPlatformDb("x-scout-profile-real-planner-");
    const userId = seedUser("profile-real-planner-user");
    const profile = supportedProfile(userId);
    const loader = spyLoader(() => profile);

    const requests: Array<Array<{ role: string; content: string }>> = [];
    const answers = [
      "not json",
      '{"queries":["freight operating system software","carrier freight os tooling"]}',
      '{"queries":["freight software","freight ops"]}',
      '{"queries":["freight data","freight facts"]}',
    ];
    const original = globalThis.fetch;
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const body = parseBodyRow(JSON.parse(String(init?.body ?? "{}")));
      requests.push(body.messages);
      const content = answers[Math.min(requests.length, answers.length) - 1] ?? "";
      return new Response(
        JSON.stringify({ model: "stub", choices: [{ message: { content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;
    restoreFetch = () => {
      globalThis.fetch = original;
    };

    const result = await runScoutCollect({
      agenda: "B2B freight OS",
      bucketSize: 5,
      targetCool: 1,
      userId,
      session,
      deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, emptySearch: true }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(loader.calls, [userId]);
    assert.equal(requests.length, 4, "initial + repair + broaden + one replan");
    for (const messages of requests) {
      const prompt = messages[1]!.content;
      assert.equal(prompt.split(SCOUT_PROFILE_BLOCK_HEADER).length - 1, 1);
      assert.match(prompt, /"kind":"fact_add","bias":"prefer"/);
      assert.doesNotMatch(prompt, new RegExp(userId));
    }
    assert.equal(requests[1]![1]!.content, requests[0]![1]!.content, "repair reuses the first prompt");
    assert.match(requests[2]![1]!.content, /too phrase-y/);
    assert.match(requests[3]![1]!.content, /Low yield/);
  });
});

await describe("runScoutCollect — the same snapshot reaches every triage batch (C12)", async () => {
  type TriageSeen = { userId?: string; profile?: ScoutProfile | null; ids: string[] };

  function triageSpy(seen: TriageSeen[], engageFor: (batch: number) => "skip" | "consider") {
    return async (opts: {
      threads: Parameters<NonNullable<ScoutCollectDeps["triageThreads"]>>[0]["threads"];
      userId?: string;
      profile?: ScoutProfile | null;
    }) => {
      seen.push({ userId: opts.userId, profile: opts.profile, ids: opts.threads.map((t) => t.id) });
      const engage = engageFor(seen.length);
      return {
        threads: opts.threads.map((t) => ({ ...t, engage, baitScore: engage === "skip" ? 90 : 20 })),
      };
    };
  }

  await it("one load total across plan, replan and multiple triage buckets", async () => {
    withLlmKey();
    temp = openTempPlatformDb("x-scout-profile-triage-");
    const userId = seedUser("profile-triage-user");
    const profile = supportedProfile(userId);
    const loader = spyLoader(() => profile);
    const planCalls: PlanCall[] = [];
    const seen: TriageSeen[] = [];
    // First bucket triages to all-skip (refill), second qualifies.
    const result = await runScoutCollect({
      agenda: "B2B freight OS",
      bucketSize: 5,
      targetCool: 1,
      userId,
      session,
      deps: stubDeps({
        loadScoutProfile: loader.loadScoutProfile,
        planCalls,
        triageThreads: triageSpy(seen, (batch) => (batch === 1 ? "skip" : "consider")),
      }),
    });
    assert.equal(result.ok, true);
    assert.deepEqual(loader.calls, [userId], "exactly one read for the whole run");
    assert.ok(seen.length >= 2, "at least two triage batches");
    for (const call of seen) {
      assert.equal(call.userId, userId);
      assert.equal(call.profile, profile, "same snapshot object in every batch");
      assert.equal(call.profile?.revision, 1);
    }
    assert.equal(planCalls[0]?.opts?.profile, profile);
  });

  await it("explicit client queries forward the snapshot too; a blank identity forwards no profile", async () => {
    const profile = supportedProfile("user-a");
    const loader = spyLoader(() => profile);
    const seen: TriageSeen[] = [];
    const ok = await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      userId: " user-a ",
      session,
      deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, triageThreads: triageSpy(seen, () => "consider") }),
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(loader.calls, ["user-a"]);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.profile, profile);
    assert.equal(seen[0]?.userId, "user-a");

    const anon: TriageSeen[] = [];
    const anonLoader = spyLoader(() => profile);
    await runScoutCollect({
      queries: ["q1"],
      bucketSize: 5,
      targetCool: 1,
      session,
      deps: stubDeps({ loadScoutProfile: anonLoader.loadScoutProfile, triageThreads: triageSpy(anon, () => "consider") }),
    });
    assert.deepEqual(anonLoader.calls, []);
    assert.equal(anon[0]?.profile, null);
    assert.equal(anon[0]?.userId, "");
  });

  await it("a rejected or throwing loader forwards no profile to triage", async () => {
    for (const backing of [
      () => supportedProfile("someone-else"),
      () => {
        throw new Error("store offline");
      },
    ]) {
      const loader = spyLoader(backing);
      const seen: TriageSeen[] = [];
      await runScoutCollect({
        queries: ["q1"],
        bucketSize: 5,
        targetCool: 1,
        userId: "user-a",
        session,
        deps: stubDeps({ loadScoutProfile: loader.loadScoutProfile, triageThreads: triageSpy(seen, () => "consider") }),
      });
      assert.deepEqual(loader.calls, ["user-a"]);
      assert.equal(seen[0]?.profile, null);
    }
  });
});

function parseBodyRow(value: unknown): {
        messages: Array<{ role: string; content: string }>;
      } {
  const valid = (row: unknown): row is {
        messages: Array<{ role: string; content: string }>;
      } =>
    (isRecord(row) &&
    (Array.isArray(row.messages) && row.messages.every((item: unknown) => (isRecord(item) &&
    typeof item.role === "string" &&
    typeof item.content === "string"))));
  if (!valid(value)) throw new TypeError("Invalid database row");
  return value;
}

function unsupportedVersionProfile(profile: ScoutProfile): ScoutProfile {
  Reflect.set(profile, "version", 2);
  return profile;
}
