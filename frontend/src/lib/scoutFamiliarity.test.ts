import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseScoutFamiliarity } from "./scoutFamiliarity.ts";

/** C13 fixtures as the server serializes them. */
const EMPTY = {
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

const SKIP_ONLY = {
  ...EMPTY,
  revision: 7,
  coverage: { storedConfirmedReplies: 0, knownKindResolvedActions: 2 },
  lastLearned: { at: "2026-09-01T00:00:03.000Z", action: "dismiss", threadKind: "fact_add" },
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const LEARNING = {
  ...EMPTY,
  state: "learning",
  revision: 1,
  coverage: { storedConfirmedReplies: 1, knownKindResolvedActions: 1 },
  lastLearned: { at: "2026-09-01T00:00:01.000Z", action: "take", threadKind: "fact_add" },
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const SUPPORTED = {
  state: "supported",
  version: 1,
  revision: 10,
  score: 13,
  coverage: { storedConfirmedReplies: 5, knownKindResolvedActions: 10 },
  biases: [
    { kind: "fact_add", bias: "prefer", takes: 5, skips: 0 },
    { kind: "hollow_ask", bias: "avoid", takes: 0, skips: 5 },
  ],
  hints: [
    { category: "author", value: "alice", distinctTargets: 3 },
    { category: "topic", value: "rates", distinctTargets: 3 },
  ],
  lastLearned: { at: "2026-09-01T00:00:10.000Z", action: "skip", threadKind: "hollow_ask" },
  updatedAt: "2026-09-02T00:00:00.000Z",
};

const KEYS = [
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

await describe("parseScoutFamiliarity", () => {
  it("round-trips the C13 fixtures exactly", () => {
    for (const fixture of [EMPTY, SKIP_ONLY, LEARNING, SUPPORTED]) {
      const parsed = parseScoutFamiliarity(JSON.parse(JSON.stringify(fixture)));
      assert.deepEqual(parsed, fixture);
      assert.deepEqual(Object.keys(parsed ?? {}).sort(), KEYS);
    }
  }).catch(assert.fail);

  it("rejects absent, null and unusable values without throwing", () => {
    const bad: unknown[] = [
      undefined,
      null,
      "supported",
      [],
      { ...EMPTY, version: 2 },
      { ...EMPTY, state: "great" },
      { ...EMPTY, revision: -1 },
      { ...EMPTY, revision: 1.5 },
      { ...EMPTY, score: 101 },
      { ...EMPTY, score: "0" },
      { ...EMPTY, coverage: null },
      { ...EMPTY, coverage: { storedConfirmedReplies: 1 } },
      { ...EMPTY, updatedAt: "yesterday" },
      { ...EMPTY, updatedAt: undefined },
      { ...LEARNING, lastLearned: { at: "bad", action: "take", threadKind: null } },
      { ...LEARNING, lastLearned: { at: "2026-09-01T00:00:01.000Z", action: "like", threadKind: null } },
      { ...LEARNING, lastLearned: "take" },
    ];
    for (const value of bad) {
      assert.equal(parseScoutFamiliarity(value), null, JSON.stringify(value));
    }
  }).catch(assert.fail);

  it("drops unknown and private keys at every level", () => {
    const parsed = parseScoutFamiliarity({
      ...SUPPORTED,
      userId: "u1",
      notes: ["raw"],
      kinds: { fact_add: { smoothedTakeRate: 0.9 } },
      counts: { takes: 9 },
      biases: [{ ...SUPPORTED.biases[0], smoothedTakeRate: 0.8, dismissals: 2 }],
      hints: [{ ...SUPPORTED.hints[0], ids: [1], takes: 3 }],
      lastLearned: { ...SUPPORTED.lastLearned, eventKey: "reply:r1" },
    });
    assert.ok(parsed);
    assert.deepEqual(Object.keys(parsed).sort(), KEYS);
    assert.deepEqual(parsed.biases, [SUPPORTED.biases[0]]);
    assert.deepEqual(parsed.hints, [SUPPORTED.hints[0]]);
    assert.deepEqual(parsed.lastLearned, SUPPORTED.lastLearned);
    const json = JSON.stringify(parsed);
    for (const forbidden of ["userId", "notes", "kinds", "counts", "smoothedTakeRate", "eventKey", "ids"]) {
      assert.equal(json.includes(forbidden), false, forbidden);
    }
  }).catch(assert.fail);

  it("filters invalid list entries and caps the lists", () => {
    const parsed = parseScoutFamiliarity({
      ...SUPPORTED,
      biases: [
        { kind: "weird", bias: "prefer", takes: 1, skips: 0 },
        { kind: "fact_add", bias: "neutral", takes: 1, skips: 0 },
        { kind: "fact_add", bias: "prefer", takes: -1, skips: 0 },
        { kind: "fact_add", bias: "prefer", takes: 1, skips: 0 },
        { kind: "fact_add", bias: "avoid", takes: 2, skips: 2 },
        { kind: "other", bias: "avoid", takes: 0, skips: 6 },
        { kind: "bare_news", bias: "avoid", takes: 0, skips: 5 },
        { kind: "timely_take", bias: "prefer", takes: 5, skips: 0 },
        "fact_add",
      ],
      hints: [
        { category: "like", value: "rates", distinctTargets: 3 },
        { category: "topic", value: "", distinctTargets: 3 },
        { category: "topic", value: " padded", distinctTargets: 3 },
        { category: "topic", value: "x".repeat(65), distinctTargets: 3 },
        { category: "topic", value: "rates", distinctTargets: "3" },
        { category: "topic", value: "rates", distinctTargets: 3 },
        { category: "topic", value: "rates", distinctTargets: 4 },
        { category: "author", value: "alice", distinctTargets: 3 },
        { category: "author", value: "bob", distinctTargets: 3 },
        { category: "author", value: "carol", distinctTargets: 3 },
      ],
    });
    assert.ok(parsed);
    assert.deepEqual(parsed.biases, [
      { kind: "fact_add", bias: "prefer", takes: 1, skips: 0 },
      { kind: "other", bias: "avoid", takes: 0, skips: 6 },
      { kind: "bare_news", bias: "avoid", takes: 0, skips: 5 },
    ]);
    assert.deepEqual(parsed.hints, [
      { category: "topic", value: "rates", distinctTargets: 3 },
      { category: "author", value: "alice", distinctTargets: 3 },
      { category: "author", value: "bob", distinctTargets: 3 },
    ]);
  }).catch(assert.fail);

  it("never carries lists outside the supported state", () => {
    const parsed = parseScoutFamiliarity({ ...SUPPORTED, state: "learning" });
    assert.ok(parsed);
    assert.equal(parsed.state, "learning");
    assert.deepEqual(parsed.biases, []);
    assert.deepEqual(parsed.hints, []);
    const empty = parseScoutFamiliarity({ ...SUPPORTED, state: "empty" });
    assert.deepEqual(empty?.biases, []);
    assert.deepEqual(empty?.hints, []);
  }).catch(assert.fail);

  it("reads an unknown lastLearned kind as unknown, not as a claim", () => {
    const parsed = parseScoutFamiliarity({
      ...LEARNING,
      lastLearned: { at: "2026-09-01T00:00:01.000Z", action: "skip", threadKind: "mystery" },
    });
    assert.deepEqual(parsed?.lastLearned, {
      at: "2026-09-01T00:00:01.000Z",
      action: "skip",
      threadKind: null,
    });
  }).catch(assert.fail);
});
