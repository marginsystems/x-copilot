import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { THREAD_KINDS, type ThreadKind } from "./threadTriage.ts";
import {
  emptyScoutProfile,
  familiarityScore,
  reduceScoutProfile,
  smoothedTakeRate,
  type ScoutProfile,
  type ScoutProfileObservation,
} from "./scoutProfile.ts";

let seq = 0;

function obs(
  overrides: Partial<ScoutProfileObservation> & {
    action: ScoutProfileObservation["action"];
  },
): ScoutProfileObservation {
  seq += 1;
  const at = overrides.at ?? `2026-09-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`;
  const eventKey =
    overrides.eventKey ??
    (overrides.action === "take"
      ? `reply:r${seq}`
      : `${overrides.action}:scout:c${seq}`);
  return {
    eventKey,
    at,
    changedAt: overrides.changedAt ?? at,
    targetId: overrides.targetId ?? `t${seq}`,
    targetAliases: overrides.targetAliases ?? [],
    threadKind: overrides.threadKind ?? null,
    author: overrides.author ?? null,
    topics: overrides.topics ?? [],
    replyId:
      overrides.replyId ?? (overrides.action === "take" ? `r${seq}` : null),
    storedReplyVerified: overrides.storedReplyVerified ?? false,
    action: overrides.action,
  };
}

function reduce(
  observations: ScoutProfileObservation[],
  extra: { revision?: number; updatedAt?: string | null } = {},
): ScoutProfile {
  return reduceScoutProfile({
    userId: "u1",
    revision: extra.revision ?? observations.length,
    updatedAt: extra.updatedAt ?? "2026-09-02T00:00:00.000Z",
    observations,
  });
}

function takes(n: number, kind: ThreadKind | null, stored = true) {
  return Array.from({ length: n }, () =>
    obs({ action: "take", threadKind: kind, storedReplyVerified: stored }),
  );
}
function skips(n: number, kind: ThreadKind | null) {
  return Array.from({ length: n }, () => obs({ action: "skip", threadKind: kind }));
}

describe("familiarityScore (frozen formula)", () => {
  it("matches the brief's worked examples", () => {
    assert.equal(familiarityScore(0, 0), 0);
    assert.equal(familiarityScore(1, 1), 0);
    assert.equal(familiarityScore(10, 10), 25);
    assert.equal(familiarityScore(20, 20), 100);
    assert.equal(familiarityScore(40, 5), 25);
    assert.equal(familiarityScore(7, 0), 0);
    assert.equal(familiarityScore(0, 40), 0);
  });
});

describe("reduceScoutProfile — empty and shape", () => {
  it("returns the deterministic empty profile for no evidence", () => {
    const profile = reduceScoutProfile({
      userId: "u1",
      revision: 0,
      updatedAt: null,
      observations: [],
    });
    assert.deepEqual(profile, emptyScoutProfile("u1"));
    assert.equal(profile.revision, 0);
    assert.equal(profile.updatedAt, null);
    assert.equal(profile.lastLearned, null);
    assert.equal(profile.familiarity.state, "empty");
    assert.deepEqual(Object.keys(profile.kinds).sort(), [...THREAD_KINDS].sort());
    for (const kind of THREAD_KINDS) {
      assert.deepEqual(profile.kinds[kind], {
        takes: 0,
        skips: 0,
        dismissals: 0,
        resolvedActions: 0,
        smoothedTakeRate: 0.5,
        bias: "learning",
      });
    }
  });

  it("rejects a blank user id", () => {
    assert.throws(() =>
      reduceScoutProfile({
        userId: "  ",
        revision: 0,
        updatedAt: null,
        observations: [],
      }),
    );
  });

  it("keeps the frozen top-level key set", () => {
    const profile = reduce([obs({ action: "take", threadKind: "fact_add" })]);
    assert.deepEqual(Object.keys(profile).sort(), [
      "authors",
      "counts",
      "coverage",
      "familiarity",
      "kinds",
      "lastLearned",
      "overall",
      "revision",
      "topics",
      "updatedAt",
      "userId",
      "version",
    ]);
    assert.equal(profile.version, 1);
  });
});

describe("reduceScoutProfile — kind rates and bias floors", () => {
  it("4 takes / 1 skip is 5/7 and prefers against a 5/5 known overall", () => {
    const observations = [
      ...takes(4, "fact_add"),
      ...skips(1, "fact_add"),
      ...takes(1, "timely_take"),
      ...skips(4, "timely_take"),
    ];
    const profile = reduce(observations);
    assert.equal(profile.overall.takes, 5);
    assert.equal(profile.overall.skips, 5);
    assert.equal(profile.overall.resolvedActions, 10);
    assert.equal(profile.overall.smoothedTakeRate, 6 / 12);
    assert.equal(profile.kinds.fact_add.smoothedTakeRate, 5 / 7);
    assert.equal(profile.kinds.fact_add.bias, "prefer");
    assert.equal(profile.kinds.timely_take.smoothedTakeRate, 2 / 7);
    assert.equal(profile.kinds.timely_take.bias, "avoid");
    assert.equal(profile.kinds.other.bias, "learning");
    assert.equal(smoothedTakeRate(4, 1), 5 / 7);
  });

  it("a kind with 4 resolved stays learning even when overall has 10", () => {
    const profile = reduce([
      ...takes(4, "fact_add"),
      ...takes(3, "timely_take"),
      ...skips(3, "timely_take"),
    ]);
    assert.equal(profile.overall.resolvedActions, 10);
    assert.equal(profile.kinds.fact_add.resolvedActions, 4);
    assert.equal(profile.kinds.fact_add.bias, "learning");
    // timely_take 4/8 = 0.5 vs overall 8/12 → avoid; it meets both floors.
    assert.equal(profile.kinds.timely_take.bias, "avoid");
  });

  it("overall with 9 resolved keeps every kind learning", () => {
    const profile = reduce([...takes(5, "fact_add"), ...skips(4, "timely_take")]);
    assert.equal(profile.overall.resolvedActions, 9);
    assert.equal(profile.kinds.fact_add.resolvedActions, 5);
    assert.equal(profile.kinds.fact_add.bias, "learning");
  });

  it("equal rate is neutral", () => {
    // Both kinds 3 takes / 2 skips → 4/7 each; overall 6/4 → 7/12 ≠ 4/7.
    // Build one kind equal to overall instead: kind A 5/5 (6/12), kind B 5/5.
    const profile = reduce([
      ...takes(5, "fact_add"),
      ...skips(5, "fact_add"),
      ...takes(5, "timely_take"),
      ...skips(5, "timely_take"),
    ]);
    assert.equal(profile.kinds.fact_add.bias, "neutral");
    assert.equal(profile.kinds.timely_take.bias, "neutral");
  });

  it("unknown-kind rows and dismissals do not inflate rate denominators", () => {
    const profile = reduce([
      ...takes(4, "fact_add"),
      ...skips(1, "fact_add"),
      ...takes(1, "timely_take"),
      ...skips(4, "timely_take"),
      ...skips(6, null),
      ...takes(2, null),
      obs({ action: "dismiss", threadKind: "fact_add" }),
      obs({ action: "dismiss", threadKind: "fact_add" }),
      obs({ action: "dismiss", threadKind: null }),
    ]);
    assert.equal(profile.overall.resolvedActions, 10);
    assert.equal(profile.overall.smoothedTakeRate, 6 / 12);
    assert.equal(profile.kinds.fact_add.resolvedActions, 5);
    assert.equal(profile.kinds.fact_add.dismissals, 2);
    assert.equal(profile.kinds.fact_add.smoothedTakeRate, 5 / 7);
    assert.equal(profile.kinds.fact_add.bias, "prefer");
    assert.equal(profile.coverage.knownKindResolvedActions, 10);
    assert.equal(profile.coverage.unknownKindResolvedActions, 8);
    assert.equal(profile.counts.takes, 7);
    assert.equal(profile.counts.skips, 11);
    assert.equal(profile.counts.dismissals, 3);
  });

  it("known `other` is a real kind", () => {
    const profile = reduce([...takes(3, "other")]);
    assert.equal(profile.kinds.other.takes, 3);
    assert.equal(profile.coverage.knownKindResolvedActions, 3);
    assert.equal(profile.coverage.unknownKindResolvedActions, 0);
  });
});

describe("reduceScoutProfile — dedupe and supersession", () => {
  it("does not count repeated deliveries of one reply as multiple takes", () => {
    const first = obs({
      action: "take",
      eventKey: "reply:r1",
      replyId: "r1",
      threadKind: "fact_add",
      at: "2026-09-01T00:00:00.000Z",
      storedReplyVerified: true,
    });
    const retry = { ...first, at: "2026-09-01T00:05:00.000Z" };
    const profile = reduce([first, retry, retry]);
    assert.equal(profile.counts.takes, 1);
    assert.equal(profile.kinds.fact_add.takes, 1);
    assert.equal(profile.coverage.storedConfirmedReplies, 1);
  });

  it("a later take supersedes an earlier skip on the same target but keeps raw counts", () => {
    const skip = obs({
      action: "skip",
      targetId: "T",
      threadKind: "fact_add",
      at: "2026-09-01T00:00:00.000Z",
    });
    const take = obs({
      action: "take",
      targetId: "T",
      threadKind: "fact_add",
      at: "2026-09-01T01:00:00.000Z",
    });
    const profile = reduce([skip, take]);
    assert.deepEqual(profile.counts, { takes: 1, skips: 1, dismissals: 0 });
    assert.equal(profile.kinds.fact_add.skips, 0);
    assert.equal(profile.kinds.fact_add.takes, 1);
    assert.equal(profile.kinds.fact_add.resolvedActions, 1);
  });

  it("supersession matches captured card aliases, not authors", () => {
    const skipByCard = obs({
      action: "skip",
      targetId: null,
      targetAliases: ["card9"],
      threadKind: "fact_add",
      author: "alice",
      at: "2026-09-01T00:00:00.000Z",
    });
    const takeWithAlias = obs({
      action: "take",
      targetId: "T9",
      targetAliases: ["card9"],
      threadKind: "fact_add",
      author: "alice",
      at: "2026-09-01T01:00:00.000Z",
    });
    const skipSameAuthorOtherTarget = obs({
      action: "skip",
      targetId: "T10",
      threadKind: "fact_add",
      author: "alice",
      at: "2026-09-01T00:30:00.000Z",
    });
    const profile = reduce([skipByCard, takeWithAlias, skipSameAuthorOtherTarget]);
    assert.equal(profile.kinds.fact_add.skips, 1);
    assert.equal(profile.kinds.fact_add.takes, 1);
  });

  it("a skip after the take is not superseded", () => {
    const take = obs({
      action: "take",
      targetId: "T",
      threadKind: "fact_add",
      at: "2026-09-01T00:00:00.000Z",
    });
    const laterSkip = obs({
      action: "skip",
      targetId: "T",
      threadKind: "fact_add",
      at: "2026-09-01T01:00:00.000Z",
    });
    const profile = reduce([take, laterSkip]);
    assert.equal(profile.kinds.fact_add.skips, 1);
  });

  it("dismissals stay separate even after a take on the same target", () => {
    const dismiss = obs({
      action: "dismiss",
      targetId: "T",
      threadKind: "fact_add",
      at: "2026-09-01T00:00:00.000Z",
    });
    const take = obs({
      action: "take",
      targetId: "T",
      threadKind: "fact_add",
      at: "2026-09-01T01:00:00.000Z",
    });
    const profile = reduce([dismiss, take]);
    assert.equal(profile.kinds.fact_add.dismissals, 1);
    assert.equal(profile.kinds.fact_add.takes, 1);
    assert.equal(profile.kinds.fact_add.resolvedActions, 1);
    assert.equal(profile.counts.dismissals, 1);
  });

  it("is order independent", () => {
    const observations = [
      ...takes(4, "fact_add"),
      ...skips(3, "timely_take"),
      obs({ action: "dismiss", threadKind: "other", topics: ["ai"] }),
      obs({ action: "skip", targetId: "Z", threadKind: "fact_add", at: "2026-09-01T00:00:00.000Z" }),
      obs({ action: "take", targetId: "Z", threadKind: "fact_add", at: "2026-09-01T02:00:00.000Z" }),
    ];
    const forward = reduce(observations);
    const backward = reduce([...observations].reverse());
    assert.deepEqual(forward, backward);
  });
});

describe("reduceScoutProfile — topic and author hints", () => {
  it("three events on one target do not satisfy the distinct-target floor", () => {
    const profile = reduce([
      obs({ action: "skip", targetId: "T", topics: ["ai"], author: "alice", at: "2026-09-01T00:00:00.000Z" }),
      obs({ action: "dismiss", targetId: "T", topics: ["ai"], author: "alice", at: "2026-09-01T00:01:00.000Z" }),
      obs({ action: "take", targetId: "T", topics: ["ai"], author: "alice", at: "2026-09-01T00:02:00.000Z" }),
    ]);
    assert.deepEqual(profile.topics, []);
    assert.deepEqual(profile.authors, []);
  });

  it("three distinct targets support a hint with resolved and dismissal counts", () => {
    const profile = reduce([
      obs({ action: "take", targetId: "A", topics: ["ai", "ai"], author: "alice" }),
      obs({ action: "skip", targetId: "B", topics: ["ai"], author: "alice" }),
      obs({ action: "dismiss", targetId: "C", topics: ["ai"], author: "alice" }),
    ]);
    assert.deepEqual(profile.topics, [
      { value: "ai", takes: 1, skips: 1, dismissals: 1, distinctTargets: 3 },
    ]);
    assert.deepEqual(profile.authors, [
      { value: "alice", takes: 1, skips: 1, dismissals: 1, distinctTargets: 3 },
    ]);
  });

  it("caps at three hints ordered by distinctTargets then value", () => {
    const observations: ScoutProfileObservation[] = [];
    const spread = (topic: string, n: number) => {
      for (let i = 0; i < n; i++) {
        observations.push(obs({ action: "take", targetId: `${topic}-${i}`, topics: [topic] }));
      }
    };
    spread("zeta", 4);
    spread("alpha", 3);
    spread("beta", 3);
    spread("gamma", 3);
    spread("tiny", 2);
    const profile = reduce(observations);
    assert.deepEqual(
      profile.topics.map((h) => h.value),
      ["zeta", "alpha", "beta"],
    );
    assert.equal(profile.topics.length, 3);
  });

  it("a superseded skip does not add skip credit but its target counts once", () => {
    const profile = reduce([
      obs({ action: "skip", targetId: "A", topics: ["ai"], at: "2026-09-01T00:00:00.000Z" }),
      obs({ action: "take", targetId: "A", topics: ["ai"], at: "2026-09-01T01:00:00.000Z" }),
      obs({ action: "take", targetId: "B", topics: ["ai"] }),
      obs({ action: "take", targetId: "C", topics: ["ai"] }),
    ]);
    assert.deepEqual(profile.topics, [
      { value: "ai", takes: 3, skips: 0, dismissals: 0, distinctTargets: 3 },
    ]);
  });
});

describe("reduceScoutProfile — familiarity and lastLearned", () => {
  it("0 stored replies is empty even with known actions", () => {
    const profile = reduce([...takes(6, "fact_add", false), ...skips(6, "fact_add")]);
    assert.equal(profile.coverage.storedConfirmedReplies, 0);
    assert.equal(profile.familiarity.state, "empty");
    assert.equal(profile.familiarity.score, 0);
  });

  it("1 stored / 1 known resolved rounds to 0 and is learning", () => {
    const profile = reduce([...takes(1, "fact_add", true)]);
    assert.equal(profile.familiarity.score, 0);
    assert.equal(profile.familiarity.state, "learning");
  });

  it("stored replies with only unknown kinds is learning with score 0, not empty", () => {
    const profile = reduce([...takes(5, null, true)]);
    assert.equal(profile.coverage.storedConfirmedReplies, 5);
    assert.equal(profile.coverage.knownKindResolvedActions, 0);
    assert.equal(profile.familiarity.score, 0);
    assert.equal(profile.familiarity.state, "learning");
  });

  it("10 stored / 10 known → 25, supported once a kind meets both floors", () => {
    const profile = reduce([...takes(10, "fact_add", true)]);
    assert.equal(profile.familiarity.score, 25);
    assert.equal(profile.kinds.fact_add.bias, "neutral");
    assert.equal(profile.familiarity.state, "supported");
  });

  it("20 stored / 20 known → 100", () => {
    const profile = reduce([...takes(20, "fact_add", true)]);
    assert.equal(profile.familiarity.score, 100);
  });

  it("a supported topic hint alone makes a sparse profile supported", () => {
    const profile = reduce([
      obs({ action: "take", targetId: "A", topics: ["ai"], storedReplyVerified: true }),
      obs({ action: "skip", targetId: "B", topics: ["ai"] }),
      obs({ action: "skip", targetId: "C", topics: ["ai"] }),
    ]);
    assert.equal(profile.familiarity.state, "supported");
    assert.equal(profile.familiarity.score, 0);
  });

  it("a confirmed take without a saved note earns no stored-reply credit", () => {
    const profile = reduce([
      obs({ action: "take", replyId: "r1", storedReplyVerified: false }),
      obs({ action: "take", replyId: "r2", storedReplyVerified: true }),
    ]);
    assert.equal(profile.counts.takes, 2);
    assert.equal(profile.coverage.storedConfirmedReplies, 1);
  });

  it("lastLearned uses the latest material change time, not read time", () => {
    const profile = reduce(
      [
        obs({ action: "take", threadKind: "fact_add", at: "2026-09-01T00:00:00.000Z", changedAt: "2026-09-03T00:00:00.000Z" }),
        obs({ action: "skip", threadKind: null, at: "2026-09-02T00:00:00.000Z", changedAt: "2026-09-02T00:00:00.000Z" }),
      ],
      { revision: 7, updatedAt: "2026-09-03T00:00:00.000Z" },
    );
    assert.equal(profile.revision, 7);
    assert.equal(profile.updatedAt, "2026-09-03T00:00:00.000Z");
    assert.deepEqual(profile.lastLearned, {
      at: "2026-09-03T00:00:00.000Z",
      action: "take",
      threadKind: "fact_add",
    });
  });
});
