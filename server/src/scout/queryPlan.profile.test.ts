import { isRecord } from "../platform/unknownValue.js";
/**
 * C11: query planning consumes the run's ScoutProfile snapshot.
 *
 * Captured message arrays are compared against literal current-HEAD
 * baselines: any profile that carries no supported preference (absent,
 * null, empty, empty at a nonzero revision, learning, neutral-only,
 * unusable) must leave every planner request byte-identical — initial,
 * history/yield, invalid-JSON repair, phrase-y broaden and
 * missing-agenda-noun broaden. A supported profile adds exactly one bounded
 * block, carried unchanged into repair and broaden, and a mocked provider
 * that actually inspects that block can pick different valid queries.
 * Mocks prove propagation and containment, not live recommendation quality.
 */
import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  SYSTEM,
  hasAgendaNounQueries,
  isPhraseyPlan,
  planQueriesFromAgenda,
  type PlanQueriesOpts,
} from "./queryPlan.ts";
import {
  emptyScoutProfile,
  reduceScoutProfile,
  type ScoutProfile,
  type ScoutProfileObservation,
} from "./scoutProfile.ts";
import {
  SCOUT_PROFILE_BLOCK_HEADER,
  formatScoutProfileBlock,
} from "./scoutProfilePrompt.ts";
import type { ThreadKind } from "./threadTriage.ts";

type Message = { role: string; content: string };
type Responder = (messages: Message[], call: number) => string;

/** Stub DeepSeek transport: capture each request's messages; answer via responder. */
function stubDeepseek(respond: Responder): { requests: Message[][]; restore: () => void } {
  const requests: Message[][] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
    const body = parseStubDeepseekRow(JSON.parse(String(init?.body ?? "{}")));
    requests.push(body.messages);
    const content = respond(body.messages, requests.length);
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

function queue(...answers: string[]): Responder {
  return (_messages, call) => answers[Math.min(call, answers.length) - 1] ?? "";
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
function reduce(observations: ScoutProfileObservation[], revision = Math.max(1, observations.length)) {
  return reduceScoutProfile({ userId: "user-a", revision, updatedAt: "2026-09-02T00:00:00.000Z", observations });
}

/** Supported: fact_add prefer, timely_take avoid, topic "freight", author "carrierco". */
function supportedProfile(): ScoutProfile {
  return reduce([
    ...takes(4, "fact_add", { topics: ["freight"], author: "carrierco" }),
    ...skips(1, "fact_add"),
    ...takes(1, "timely_take"),
    ...skips(4, "timely_take"),
  ]);
}

const NO_SUPPORT_PROFILES: Array<[string, ScoutProfile | null | undefined]> = [
  ["absent", undefined],
  ["null", null],
  ["empty revision 0", emptyScoutProfile("user-a")],
  ["empty state at revision 3", { ...emptyScoutProfile("user-a"), revision: 3 }],
  ["learning", reduce(takes(1, "fact_add"))],
  [
    "neutral-only",
    reduce([...takes(5, "fact_add"), ...skips(5, "fact_add"), ...takes(5, "timely_take"), ...skips(5, "timely_take")]),
  ],
  ["unusable version", unsupportedVersionProfile(supportedProfile())],
];

// ------------------------------------------------------- literal baselines

const AGENDA = "B2B freight OS";
const SYSTEM_SHA256 = "4bee7a9c7251b981435d6977c70a26fda1e17757efd731a7a5af8d3db948c50f";
const BROADEN_LINE =
  "Broaden within the agenda topic family: prefer shorter high-recall 2-word Latest keywords (3 ok when needed); mix broad + tighter; do not copy the agenda sentence; at least two queries must contain agenda content words.";
const REPAIR_LINE =
  'Your previous reply was not valid JSON of the form {"queries":["q1","q2"]}. Reply again with ONLY that JSON.';

const INITIAL_USER = 'Agenda: "B2B freight OS"\n\nRespond with JSON only.';
const HISTORY_OPTS: PlanQueriesOpts = {
  priorQueries: ["freight software"],
  yieldNote: "unique=75 usable=0 cool=0 calls=8",
};
const HISTORY_USER =
  'Agenda: "B2B freight OS"\n\nAlready-flown queries (do not repeat): ["freight software"]\n\nAlready-flown yield: unique=75 usable=0 cool=0 calls=8\n\n' +
  BROADEN_LINE +
  "\n\nRespond with JSON only.";
const PHRASEY_FIRST = '{"queries":["freight operating system software","carrier freight os tooling"]}';
const PHRASEY_BROADEN_USER =
  'Agenda: "B2B freight OS"\n\nAlready-flown queries (do not repeat): ["freight operating system software","carrier freight os tooling"]\n\nAlready-flown yield: First plan was too phrase-y / agenda-echoing. Broaden to shorter high-recall 2-word keywords; at least two queries must contain an agenda content noun.\n\n' +
  BROADEN_LINE +
  "\n\nRespond with JSON only.";
const NOUNLESS_FIRST = '{"queries":["just shipped","startup claims"]}';
const NOUN_BROADEN_USER =
  'Agenda: "B2B freight OS"\n\nAlready-flown queries (do not repeat): ["just shipped","startup claims"]\n\nAlready-flown yield: First plan was not grounded in the agenda. Keep 2-word Latest keywords; do not copy the agenda sentence; at least two queries must contain an agenda content noun.\n\n' +
  BROADEN_LINE +
  "\n\nRespond with JSON only.";
const GOOD = '{"queries":["freight software","freight ops","just shipped"]}';

const sys = (): Message => ({ role: "system", content: SYSTEM });
const user = (content: string): Message => ({ role: "user", content });
const assistant = (content: string): Message => ({ role: "assistant", content });

await describe("queryPlan profile parity — literal current-HEAD baselines", async () => {
  let restore: (() => void) | null = null;
  let prevKey: string | undefined;
  beforeEach(() => {
    prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
  });
  afterEach(() => {
    restore?.();
    restore = null;
    if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevKey;
  });

  await it("SYSTEM is unchanged", () => {
    assert.equal(SYSTEM.length, 1825);
    assert.equal(createHash("sha256").update(SYSTEM).digest("hex"), SYSTEM_SHA256);
  });

  for (const [label, profile] of NO_SUPPORT_PROFILES) {
    await it(`initial plan with ${label} profile`, async () => {
      const stub = stubDeepseek(queue(GOOD));
      restore = stub.restore;
      const result = await planQueriesFromAgenda(AGENDA, profile === undefined ? undefined : { profile });
      assert.equal(result.ok, true);
      assert.deepEqual(stub.requests, [[sys(), user(INITIAL_USER)]]);
    });

    await it(`history/yield plan with ${label} profile`, async () => {
      const stub = stubDeepseek(queue(GOOD));
      restore = stub.restore;
      await planQueriesFromAgenda(AGENDA, { ...HISTORY_OPTS, profile });
      assert.deepEqual(stub.requests, [[sys(), user(HISTORY_USER)]]);
    });

    await it(`invalid-JSON repair with ${label} profile`, async () => {
      const stub = stubDeepseek(queue("not json at all", GOOD));
      restore = stub.restore;
      const result = await planQueriesFromAgenda(AGENDA, { ...HISTORY_OPTS, profile });
      assert.equal(result.ok, true);
      assert.deepEqual(stub.requests, [
        [sys(), user(HISTORY_USER)],
        [sys(), user(HISTORY_USER), assistant("not json at all"), user(REPAIR_LINE)],
      ]);
    });

    await it(`phrase-y broaden with ${label} profile`, async () => {
      const stub = stubDeepseek(queue(PHRASEY_FIRST, GOOD));
      restore = stub.restore;
      const result = await planQueriesFromAgenda(AGENDA, { profile });
      assert.equal(result.ok, true);
      assert.deepEqual(stub.requests, [
        [sys(), user(INITIAL_USER)],
        [sys(), user(PHRASEY_BROADEN_USER)],
      ]);
    });

    await it(`missing-agenda-noun broaden with ${label} profile`, async () => {
      const stub = stubDeepseek(queue(NOUNLESS_FIRST, GOOD));
      restore = stub.restore;
      const result = await planQueriesFromAgenda(AGENDA, { profile });
      assert.equal(result.ok, true);
      assert.deepEqual(stub.requests, [
        [sys(), user(INITIAL_USER)],
        [sys(), user(NOUN_BROADEN_USER)],
      ]);
    });
  }
});

await describe("queryPlan profile — supported snapshot", async () => {
  let restore: (() => void) | null = null;
  let prevKey: string | undefined;
  beforeEach(() => {
    prevKey = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "test-key";
  });
  afterEach(() => {
    restore?.();
    restore = null;
    if (prevKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prevKey;
  });

  const profile = supportedProfile();
  const block = formatScoutProfileBlock(profile);
  const INITIAL_WITH_PROFILE = `Agenda: "B2B freight OS"\n\n${block}\n\nRespond with JSON only.`;
  const PHRASEY_BROADEN_WITH_PROFILE =
    'Agenda: "B2B freight OS"\n\nAlready-flown queries (do not repeat): ["freight operating system software","carrier freight os tooling"]\n\nAlready-flown yield: First plan was too phrase-y / agenda-echoing. Broaden to shorter high-recall 2-word keywords; at least two queries must contain an agenda content noun.\n\n' +
    BROADEN_LINE +
    `\n\n${block}\n\nRespond with JSON only.`;

  const occurrences = (text: string) => text.split(SCOUT_PROFILE_BLOCK_HEADER).length - 1;

  await it("adds exactly one bounded block before the JSON instruction and keeps SYSTEM", async () => {
    assert.notEqual(block, "");
    const stub = stubDeepseek(queue(GOOD));
    restore = stub.restore;
    const result = await planQueriesFromAgenda(AGENDA, { profile });
    assert.equal(result.ok, true);
    assert.deepEqual(stub.requests, [[sys(), user(INITIAL_WITH_PROFILE)]]);
    assert.equal(occurrences(INITIAL_WITH_PROFILE), 1);
    assert.doesNotMatch(INITIAL_WITH_PROFILE, /user-a/);
  });

  await it("carries the identical block into invalid-JSON repair and phrase-y broaden", async () => {
    const stub = stubDeepseek(queue("nope", PHRASEY_FIRST, GOOD));
    restore = stub.restore;
    const result = await planQueriesFromAgenda(AGENDA, { profile });
    assert.equal(result.ok, true);
    assert.deepEqual(stub.requests, [
      [sys(), user(INITIAL_WITH_PROFILE)],
      [sys(), user(INITIAL_WITH_PROFILE), assistant("nope"), user(REPAIR_LINE)],
      [sys(), user(PHRASEY_BROADEN_WITH_PROFILE)],
    ]);
    for (const messages of stub.requests) {
      assert.equal(occurrences(messages[1]!.content), 1);
    }
    // Same call/repair budget as the no-profile path for the same answers.
    const bare = stubDeepseek(queue("nope", PHRASEY_FIRST, GOOD));
    restore = () => {
      stub.restore();
      bare.restore();
    };
    await planQueriesFromAgenda(AGENDA, {});
    assert.equal(bare.requests.length, stub.requests.length);
  });

  await it("a provider that inspects the block can choose different valid agenda-grounded queries", async () => {
    const respond: Responder = (messages) => {
      const prompt = messages[1]!.content;
      if (
        prompt.includes(SCOUT_PROFILE_BLOCK_HEADER) &&
        prompt.includes('"kind":"fact_add","bias":"prefer"') &&
        prompt.includes('"value":"freight"')
      ) {
        return '{"queries":["freight facts","freight data","shipping numbers"]}';
      }
      return '{"queries":["freight software","freight ops","just shipped"]}';
    };
    const withStub = stubDeepseek(respond);
    const withProfile = await planQueriesFromAgenda(AGENDA, { profile });
    withStub.restore();
    const withoutStub = stubDeepseek(respond);
    restore = withoutStub.restore;
    const withoutProfile = await planQueriesFromAgenda(AGENDA, {});

    assert.equal(withProfile.ok, true);
    assert.equal(withoutProfile.ok, true);
    if (!withProfile.ok || !withoutProfile.ok) return;
    assert.notDeepEqual(withProfile.queries, withoutProfile.queries);
    for (const plan of [withProfile.queries, withoutProfile.queries]) {
      assert.ok(plan.length >= 2 && plan.length <= 4);
      assert.equal(hasAgendaNounQueries(plan, AGENDA), true);
      assert.equal(isPhraseyPlan(plan), false);
      assert.ok(plan.every((q) => !/\bfrom:/i.test(q)), "no learned-author from: filter");
      assert.ok(plan.every((q) => !q.includes("carrierco")), "author hint is not a query");
    }
    assert.equal(withStub.requests.length, 1);
    assert.equal(withoutStub.requests.length, 1);
    // Broad/tight guidance is the unchanged SYSTEM text, not a validator.
    assert.match(SYSTEM, /include 1–2 broad high-recall queries AND 1–2 tighter ones/);
  });

  await it("the block is data: it contains the guidance and no role or instruction lines", () => {
    const lines = block.split("\n");
    assert.equal(lines.length, 3);
    assert.doesNotMatch(lines[1]!, /^(system|user|assistant):/i);
    assert.match(block, /never turn them into from: filters/);
  });
});

function parseStubDeepseekRow(value: unknown): { messages: Message[] } {
  const valid = (row: unknown): row is { messages: Message[] } =>
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
