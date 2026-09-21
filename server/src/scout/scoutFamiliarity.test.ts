/**
 * C13: the public familiarity projection copies producer state/score/
 * coverage, emits bounded supported lists only, and fails closed on foreign,
 * malformed or private data. Fixtures are producer-backed (reduceScoutProfile)
 * wherever the reducer can express the case; hand-built profiles cover the
 * projector's own re-enforced floors and boundary validation.
 */
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closeTempPlatformDb,
  openTempPlatformDb,
  seedUser,
  type TempPlatformDb,
} from "../platform/platformDb.testHelpers.ts";
import {
  explicitEventKey,
  readScoutEvidenceRevision,
  recordScoutEvidence,
  takeEventKey,
} from "./scoutEvidence.ts";
import {
  loadScoutFamiliarity,
  projectScoutFamiliarity,
  type ScoutFamiliarityProjection,
} from "./scoutFamiliarity.ts";
import {
  emptyScoutProfile,
  reduceScoutProfile,
  type ScoutProfile,
  type ScoutProfileObservation,
} from "./scoutProfile.ts";
import { readScoutProfile, scoutProfilePathForUser } from "./scoutProfileStore.ts";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { THREAD_KINDS, type ThreadKind } from "./threadTriage.ts";

const USER = "u1";
const OTHER = "u2";
const UPDATED = "2026-09-02T00:00:00.000Z";

let seq = 0;
function obs(
  overrides: Partial<ScoutProfileObservation> & {
    action: ScoutProfileObservation["action"];
  },
): ScoutProfileObservation {
  seq += 1;
  const at = `2026-09-01T00:${String(Math.floor(seq / 60)).padStart(2, "0")}:${String(
    seq % 60,
  ).padStart(2, "0")}.000Z`;
  const eventKey =
    overrides.action === "take" ? `reply:r${seq}` : `${overrides.action}:scout:c${seq}`;
  return {
    eventKey,
    at,
    changedAt: at,
    targetId: `t${seq}`,
    targetAliases: [],
    threadKind: null,
    author: null,
    topics: [],
    replyId: overrides.action === "take" ? `r${seq}` : null,
    storedReplyVerified: overrides.action === "take",
    ...overrides,
  };
}

function reduce(
  observations: ScoutProfileObservation[],
  extra: { revision?: number; updatedAt?: string | null; userId?: string } = {},
): ScoutProfile {
  return reduceScoutProfile({
    userId: extra.userId ?? USER,
    revision: extra.revision ?? observations.length,
    updatedAt: extra.updatedAt === undefined ? UPDATED : extra.updatedAt,
    observations,
  });
}

function takes(n: number, kind: ThreadKind | null, extra: Partial<ScoutProfileObservation> = {}) {
  return Array.from({ length: n }, () => obs({ action: "take", threadKind: kind, ...extra }));
}
function skips(n: number, kind: ThreadKind | null, extra: Partial<ScoutProfileObservation> = {}) {
  return Array.from({ length: n }, () => obs({ action: "skip", threadKind: kind, ...extra }));
}

function project(profile: unknown, userId = USER): ScoutFamiliarityProjection {
  const out = projectScoutFamiliarity(profile, userId);
  assert.ok(out, "expected a projection");
  return out;
}

const EMPTY: ScoutFamiliarityProjection = {
  state: "empty",
  version: 1,
  revision: 0,
  score: 0,
  coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 0 },
  biases: [],
  hints: [],
  lastLearned: null,
  updatedAt: null,
};

const PROJECTION_KEYS = [
  "biases",
  "coverage",
  "hints",
  "lastLearned",
  "revision",
  "score",
  "state",
  "updatedAt",
  "version",
];

/** A hand-built supported profile the projector must bound and validate. */
function supportedProfile(patch: Partial<ScoutProfile> = {}): ScoutProfile {
  const base = reduce([...takes(5, "fact_add"), ...skips(5, "hollow_ask")]);
  assert.equal(base.familiarity.state, "supported");
  return { ...base, ...patch };
}

describe("projectScoutFamiliarity — producer-backed states", () => {
  it("no evidence is an honest empty object with exactly the frozen keys", () => {
    const out = project(reduce([], { revision: 0, updatedAt: null }));
    assert.deepEqual(out, EMPTY);
    assert.deepEqual(Object.keys(out).sort(), PROJECTION_KEYS);
    assert.deepEqual(project(emptyScoutProfile(USER)), EMPTY);
  });

  it("skip/dismiss-only evidence stays empty but keeps producer revision, coverage and lastLearned", () => {
    const rows = [
      ...skips(2, "hollow_ask"),
      obs({ action: "dismiss", threadKind: "fact_add" }),
    ];
    const profile = reduce(rows, { revision: 7 });
    assert.equal(profile.familiarity.state, "empty");
    const out = project(profile);
    assert.deepEqual(out, {
      state: "empty",
      version: 1,
      revision: 7,
      score: 0,
      coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 2 },
      biases: [],
      hints: [],
      lastLearned: { at: rows[2].changedAt, action: "dismiss", threadKind: "fact_add" },
      updatedAt: UPDATED,
    });
  });

  it("a stored reply with an unknown kind is learning with zero known coverage", () => {
    const rows = takes(1, null);
    const out = project(reduce(rows));
    assert.equal(out.state, "learning");
    assert.equal(out.score, 0);
    assert.deepEqual(out.coverage, { storedConfirmedReplies: 1, knownKindResolvedActions: 0 });
    assert.deepEqual(out.biases, []);
    assert.deepEqual(out.hints, []);
    assert.deepEqual(out.lastLearned, { at: rows[0].changedAt, action: "take", threadKind: null });
  });

  it("learning at score zero copies the producer state instead of deriving it", () => {
    const out = project(reduce(takes(1, "fact_add")));
    assert.equal(out.state, "learning");
    assert.equal(out.score, 0);
    assert.deepEqual(out.coverage, { storedConfirmedReplies: 1, knownKindResolvedActions: 1 });
  });

  it("supported directional: prefer/avoid kinds with counts only, sorted and bounded", () => {
    const profile = reduce([...takes(5, "fact_add"), ...skips(5, "hollow_ask")]);
    const out = project(profile);
    assert.equal(out.state, "supported");
    assert.equal(out.score, profile.familiarity.score);
    assert.equal(out.score, 13);
    assert.deepEqual(out.coverage, { storedConfirmedReplies: 5, knownKindResolvedActions: 10 });
    assert.deepEqual(out.biases, [
      { kind: "fact_add", bias: "prefer", takes: 5, skips: 0 },
      { kind: "hollow_ask", bias: "avoid", takes: 0, skips: 5 },
    ]);
    for (const bias of out.biases) {
      assert.deepEqual(Object.keys(bias).sort(), ["bias", "kind", "skips", "takes"]);
    }
    assert.deepEqual(out.hints, []);
  });

  it("supported neutral-only: state is supported while no directional bias is emitted", () => {
    const profile = reduce([
      ...takes(5, "fact_add"),
      ...skips(5, "fact_add"),
      ...takes(5, "hollow_ask"),
      ...skips(5, "hollow_ask"),
    ]);
    assert.equal(profile.familiarity.state, "supported");
    assert.equal(profile.kinds.fact_add.bias, "neutral");
    const out = project(profile);
    assert.equal(out.state, "supported");
    assert.deepEqual(out.biases, []);
    assert.deepEqual(out.hints, []);
  });

  it("supported hint-only: topic and author support without any kind bias", () => {
    const profile = reduce(takes(3, null, { topics: ["rates"], author: "alice" }));
    assert.equal(profile.familiarity.state, "supported");
    const out = project(profile);
    assert.equal(out.state, "supported");
    assert.deepEqual(out.biases, []);
    assert.deepEqual(out.hints, [
      { category: "author", value: "alice", distinctTargets: 3 },
      { category: "topic", value: "rates", distinctTargets: 3 },
    ]);
    for (const hint of out.hints) {
      assert.deepEqual(Object.keys(hint).sort(), ["category", "distinctTargets", "value"]);
    }
  });
});

describe("projectScoutFamiliarity — boundaries", () => {
  it("4/5 kind actions: the under-floor kind is not emitted, the supported one is", () => {
    const out = project(reduce([...takes(4, "fact_add"), ...skips(6, "hollow_ask")]));
    assert.equal(out.state, "supported");
    assert.deepEqual(out.biases, [{ kind: "hollow_ask", bias: "avoid", takes: 0, skips: 6 }]);
  });

  it("9/10 overall: nine resolved actions stay learning with no biases; ten are supported", () => {
    const nine = project(reduce([...takes(5, "fact_add"), ...skips(4, "hollow_ask")]));
    assert.equal(nine.state, "learning");
    assert.deepEqual(nine.biases, []);
    const ten = project(reduce([...takes(5, "fact_add"), ...skips(5, "hollow_ask")]));
    assert.equal(ten.state, "supported");
    assert.equal(ten.biases.length, 2);
  });

  it("2/3 distinct targets: two targets give no hint, three do", () => {
    const two = project(
      reduce([
        ...takes(2, null, { topics: ["rates"], targetId: "same" }),
        ...takes(1, null, { topics: ["rates"] }),
      ]),
    );
    assert.equal(two.state, "learning");
    assert.deepEqual(two.hints, []);
    const three = project(reduce(takes(3, null, { topics: ["rates"] })));
    assert.deepEqual(three.hints, [{ category: "topic", value: "rates", distinctTargets: 3 }]);
  });

  it("re-enforces the floors on a supported profile instead of trusting its lists", () => {
    const base = supportedProfile();
    const underOverall = {
      ...base,
      overall: { ...base.overall, resolvedActions: 9 },
    };
    assert.deepEqual(project(underOverall).biases, []);
    const underKind = {
      ...base,
      kinds: {
        ...base.kinds,
        fact_add: { ...base.kinds.fact_add, takes: 4, resolvedActions: 4 },
      },
    };
    assert.deepEqual(project(underKind).biases, [
      { kind: "hollow_ask", bias: "avoid", takes: 0, skips: 5 },
    ]);
    const thinHint = {
      ...base,
      topics: [{ value: "rates", takes: 2, skips: 0, dismissals: 0, distinctTargets: 2 }],
    };
    assert.deepEqual(project(thinHint).hints, []);
  });

  it("deterministic ties and caps: three biases, three hints total", () => {
    const base = supportedProfile();
    const kinds = { ...base.kinds };
    const entry = (takes: number, skips: number, bias: "prefer" | "avoid") => ({
      takes,
      skips,
      dismissals: 0,
      resolvedActions: takes + skips,
      smoothedTakeRate: 0.5,
      bias,
    });
    kinds.timely_take = entry(3, 3, "prefer");
    kinds.fact_add = entry(6, 0, "prefer");
    kinds.sharp_opinion = entry(2, 5, "avoid");
    kinds.other = entry(5, 0, "prefer");
    kinds.hollow_ask = entry(0, 0, "avoid"); // under floor, dropped
    const hint = (value: string, distinctTargets: number) => ({
      value,
      takes: 1,
      skips: 0,
      dismissals: 0,
      distinctTargets,
    });
    const out = project({
      ...base,
      overall: { takes: 16, skips: 8, resolvedActions: 24, smoothedTakeRate: 0.65 },
      kinds,
      topics: [hint("alpha", 4), hint("beta", 3)],
      authors: [hint("carol", 4), hint("dave", 3)],
    });
    assert.deepEqual(out.biases, [
      { kind: "sharp_opinion", bias: "avoid", takes: 2, skips: 5 },
      { kind: "fact_add", bias: "prefer", takes: 6, skips: 0 },
      { kind: "timely_take", bias: "prefer", takes: 3, skips: 3 },
    ]);
    assert.deepEqual(out.hints, [
      { category: "author", value: "carol", distinctTargets: 4 },
      { category: "topic", value: "alpha", distinctTargets: 4 },
      { category: "author", value: "dave", distinctTargets: 3 },
    ]);
  });

  it("never emits learning or neutral kinds, rates, dismissals or preference magnitude", () => {
    const base = supportedProfile();
    const kinds = { ...base.kinds };
    kinds.timely_take = { ...kinds.fact_add, bias: "learning" };
    kinds.other = { ...kinds.fact_add, bias: "neutral" };
    const out = project({ ...base, kinds });
    assert.deepEqual(
      out.biases.map((b) => b.kind),
      ["fact_add", "hollow_ask"],
    );
    const json = JSON.stringify(out);
    for (const forbidden of [
      "smoothedTakeRate",
      "dismissals",
      "resolvedActions",
      "unknownKindResolvedActions",
      "userId",
      "counts",
      "overall",
      "kinds",
      "topics",
      "authors",
    ]) {
      assert.equal(json.includes(`"${forbidden}"`), false, forbidden);
    }
  });

  it("emits no lists outside the supported state even when kinds would qualify", () => {
    const base = supportedProfile();
    const out = project({ ...base, familiarity: { state: "learning", score: 13 } });
    assert.equal(out.state, "learning");
    assert.deepEqual(out.biases, []);
    assert.deepEqual(out.hints, []);
  });
});

describe("projectScoutFamiliarity — validation", () => {
  it("rejects foreign ownership and blank identity", () => {
    const profile = reduce(takes(1, "fact_add"));
    assert.equal(projectScoutFamiliarity(profile, OTHER), null);
    // Owner comparison is exact on the trimmed requested identity.
    assert.equal(projectScoutFamiliarity({ ...profile, userId: " u1" }, USER), null);
    assert.ok(projectScoutFamiliarity(profile, " u1 "));
    assert.equal(projectScoutFamiliarity(reduce([], { userId: OTHER }), USER), null);
    assert.equal(projectScoutFamiliarity(profile, "  "), null);
  });

  it("rejects unusable core data to null", () => {
    const base = reduce(takes(1, "fact_add"));
    const bad: unknown[] = [
      null,
      undefined,
      "profile",
      [],
      { ...base, version: 2 },
      { ...base, userId: 1 },
      { ...base, revision: -1 },
      { ...base, revision: 1.5 },
      { ...base, revision: "1" },
      { ...base, revision: Number.MAX_SAFE_INTEGER + 2 },
      { ...base, updatedAt: "yesterday" },
      { ...base, updatedAt: undefined },
      { ...base, coverage: null },
      { ...base, coverage: { ...base.coverage, storedConfirmedReplies: "1" } },
      { ...base, coverage: { ...base.coverage, knownKindResolvedActions: -1 } },
      { ...base, coverage: { ...base.coverage, knownKindResolvedActions: Number.NaN } },
      { ...base, familiarity: "supported" },
      { ...base, familiarity: { state: "great", score: 1 } },
      { ...base, familiarity: { state: "learning", score: 101 } },
      { ...base, familiarity: { state: "learning", score: -1 } },
      { ...base, familiarity: { state: "learning", score: 0.5 } },
      { ...base, lastLearned: "take" },
      { ...base, lastLearned: { ...base.lastLearned, at: "bad" } },
      { ...base, lastLearned: { ...base.lastLearned, action: "like" } },
    ];
    for (const value of bad) {
      assert.equal(projectScoutFamiliarity(value, USER), null, JSON.stringify(value));
    }
  });

  it("filters invalid list entries and unknown lastLearned kinds without failing the projection", () => {
    const base = supportedProfile();
    const out = project({
      ...base,
      lastLearned: { at: UPDATED, action: "skip", threadKind: "weird_kind" },
      topics: [
        { value: "x", takes: 1, skips: 0, dismissals: 0, distinctTargets: 5 },
        { value: "has space", takes: 1, skips: 0, dismissals: 0, distinctTargets: 5 },
        { value: "1234", takes: 1, skips: 0, dismissals: 0, distinctTargets: 5 },
        { value: "rates", takes: 1, skips: 0, dismissals: 0, distinctTargets: "5" },
        { value: "rates", takes: 1, skips: 0, dismissals: 0, distinctTargets: 5 },
        "rates",
      ],
      authors: [
        { value: "Bad Author", takes: 1, skips: 0, dismissals: 0, distinctTargets: 5 },
        { value: "@alice", takes: 1, skips: 0, dismissals: 0, distinctTargets: 5 },
        { value: "alice", takes: 1, skips: 0, dismissals: 0, distinctTargets: 4 },
        { value: "alice", takes: 9, skips: 0, dismissals: 0, distinctTargets: 9 },
      ],
      kinds: {
        ...base.kinds,
        fact_add: { ...base.kinds.fact_add, resolvedActions: 6 }, // not takes + skips
        sharp_opinion: { takes: 3, skips: 3, bias: "prefer" }, // no resolvedActions
        other: { ...base.kinds.fact_add, bias: "prefer", takes: 5.5, skips: 0 },
      },
    });
    assert.deepEqual(out.lastLearned, { at: UPDATED, action: "skip", threadKind: null });
    assert.deepEqual(out.hints, [
      { category: "topic", value: "rates", distinctTargets: 5 },
      { category: "author", value: "alice", distinctTargets: 4 },
    ]);
    assert.deepEqual(out.biases, [{ kind: "hollow_ask", bias: "avoid", takes: 0, skips: 5 }]);
  });

  it("drops private and unknown fields wherever they appear", () => {
    const base = supportedProfile();
    const out = project({
      ...base,
      notes: ["raw note text"],
      path: "/data/scout-profile/u1.json",
      lastLearned: { ...base.lastLearned, eventKey: "reply:r1", targetId: "t1" },
      kinds: { ...base.kinds, fact_add: { ...base.kinds.fact_add, observationIds: [1] } },
      topics: [{ value: "rates", takes: 1, skips: 0, dismissals: 0, distinctTargets: 3, ids: [1] }],
    });
    assert.deepEqual(Object.keys(out).sort(), PROJECTION_KEYS);
    assert.deepEqual(Object.keys(out.lastLearned ?? {}).sort(), ["action", "at", "threadKind"]);
    assert.deepEqual(Object.keys(out.biases[0]).sort(), ["bias", "kind", "skips", "takes"]);
    assert.deepEqual(Object.keys(out.hints[0]).sort(), ["category", "distinctTargets", "value"]);
    assert.equal(JSON.stringify(out).includes("note"), false);
    assert.equal(JSON.stringify(out).includes("u1"), false);
  });

  it("only emits the closed kind enum", () => {
    const out = project(supportedProfile());
    for (const bias of out.biases) assert.ok(THREAD_KINDS.includes(bias.kind));
  });
});

describe("loadScoutFamiliarity", () => {
  function spy(backing: (userId: string) => ScoutProfile | null | undefined) {
    const calls: string[] = [];
    return {
      calls,
      load: async (userId: string) => {
        calls.push(userId);
        return backing(userId);
      },
    };
  }

  it("performs no read for a blank or missing identity", async () => {
    const loader = spy(() => emptyScoutProfile(USER));
    for (const id of [undefined, "", "   "]) {
      assert.equal(await loadScoutFamiliarity(id, loader.load), null);
    }
    assert.deepEqual(loader.calls, []);
  });

  it("reads exactly once per call with the trimmed identity", async () => {
    const loader = spy((id) => emptyScoutProfile(id));
    assert.deepEqual(await loadScoutFamiliarity(" u1 ", loader.load), EMPTY);
    assert.deepEqual(loader.calls, ["u1"]);
    await loadScoutFamiliarity("u1", loader.load);
    assert.deepEqual(loader.calls, ["u1", "u1"]);
  });

  it("thrown read, absent result, foreign owner and unusable shape are null with no retry", async () => {
    const thrower = spy(() => {
      throw new Error("profile dir unusable");
    });
    assert.equal(await loadScoutFamiliarity(USER, thrower.load), null);
    assert.deepEqual(thrower.calls, [USER]);
    assert.equal(await loadScoutFamiliarity(USER, spy(() => null).load), null);
    assert.equal(await loadScoutFamiliarity(USER, spy(() => undefined).load), null);
    assert.equal(await loadScoutFamiliarity(USER, spy(() => emptyScoutProfile(OTHER)).load), null);
    const broken = { ...emptyScoutProfile(USER), familiarity: { state: "supported", score: 500 } };
    assert.equal(
      await loadScoutFamiliarity(USER, spy(() => broken as ScoutProfile).load),
      null,
    );
  });
});

describe("loadScoutFamiliarity with the real store", () => {
  const T0 = Date.parse("2026-09-20T10:00:00.000Z");
  let temp: TempPlatformDb | undefined;
  let profileDir: string | undefined;

  afterEach(() => {
    if (temp) closeTempPlatformDb(temp);
    temp = undefined;
    if (profileDir) rmSync(profileDir, { recursive: true, force: true });
    profileDir = undefined;
  });

  function open(): { userId: string; load: (id: string) => Promise<ScoutProfile>; dir: string } {
    temp = openTempPlatformDb("x-familiarity-store-");
    profileDir = mkdtempSync(join(tmpdir(), "x-familiarity-dir-"));
    const dir = profileDir;
    const userId = seedUser("familiarity-user");
    return {
      userId,
      dir,
      load: (id) => readScoutProfile(id, { profileDir: dir, reconcile: false }),
    };
  }

  it("a no-evidence rebuild is the empty projection", async () => {
    const { userId, load, dir } = open();
    assert.equal(existsSync(scoutProfilePathForUser(userId, dir)), false);
    assert.deepEqual(await loadScoutFamiliarity(userId, load), EMPTY);
    assert.equal(existsSync(scoutProfilePathForUser(userId, dir)), true);
  });

  it("a missing projection rebuilds from temporary owned evidence; repeats are stable", async () => {
    const { userId, load, dir } = open();
    let reads = 0;
    const counted = (id: string) => {
      reads += 1;
      return load(id);
    };
    for (let i = 1; i <= 2; i++) {
      recordScoutEvidence({
        userId,
        eventKey: takeEventKey(`r${i}`),
        action: "take",
        source: "manual",
        targetId: `t${i}`,
        replyId: `r${i}`,
        actedAt: new Date(T0 + i * 1000).toISOString(),
        threadKind: "fact_add",
        noteState: "stored",
        nowMs: T0 + i * 1000,
      });
    }
    recordScoutEvidence({
      userId,
      eventKey: explicitEventKey("skip", "scout", "c3"),
      action: "skip",
      source: "scout",
      targetId: "c3",
      cardId: "c3",
      actedAt: new Date(T0 + 3000).toISOString(),
      threadKind: "hollow_ask",
      nowMs: T0 + 3000,
    });
    assert.equal(existsSync(scoutProfilePathForUser(userId, dir)), false);
    const first = await loadScoutFamiliarity(userId, counted);
    assert.ok(first);
    assert.equal(reads, 1);
    const revision = readScoutEvidenceRevision(userId);
    assert.equal(first.revision, revision.revision);
    assert.equal(first.updatedAt, revision.updatedAt);
    assert.equal(first.state, "learning");
    assert.deepEqual(first.coverage, { storedConfirmedReplies: 2, knownKindResolvedActions: 3 });
    assert.deepEqual(first.lastLearned, {
      at: new Date(T0 + 3000).toISOString(),
      action: "skip",
      threadKind: "hollow_ask",
    });
    assert.equal(JSON.stringify(first).includes(userId), false);

    const second = await loadScoutFamiliarity(userId, counted);
    assert.equal(reads, 2);
    assert.deepEqual(second, first);
  });

  it("fails soft when the store fails closed", async () => {
    const { userId } = open();
    const asFile = join(profileDir!, "not-a-dir");
    writeFileSync(asFile, "x");
    assert.equal(
      await loadScoutFamiliarity(userId, (id) =>
        readScoutProfile(id, { profileDir: asFile, reconcile: false }),
      ),
      null,
    );
  });
});
